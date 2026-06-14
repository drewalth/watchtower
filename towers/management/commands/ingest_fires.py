import io
from datetime import datetime, timezone
from functools import reduce

import pandas as pd
import requests
from django.conf import settings
from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError
from pydantic import ValidationError

from towers.models import FireDetection, WatchtowerSite
from towers.schemas import FirmsRow

# FIRMS "area" endpoint: CSV detections within a bbox over the last N days.
FIRMS_URL = (
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
    "{key}/{source}/{bbox}/{day_range}"
)

# VIIRS near-real-time sensors pulled by default. Each is a separate FIRMS
# request; widening coverage is as simple as adding a sensor to this list.
DEFAULT_SOURCES = [
    "VIIRS_NOAA20_NRT",
    "VIIRS_SNPP_NRT",
    "VIIRS_NOAA21_NRT",
]


class Command(BaseCommand):
    help = (
        "Ingest VIIRS fire detections from NASA FIRMS for the bounding box "
        "covering the seeded towers. Pulls every default sensor; sources are "
        "isolated so one failing sensor never loses the others. Idempotent."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--day-range", type=int, default=1,
            help="How many days back to fetch (1-10). Default 1.",
        )
        parser.add_argument(
            "--source", nargs="+", default=DEFAULT_SOURCES,
            help=(
                "FIRMS source/sensor(s) to pull, space-separated. "
                f"Default: {' '.join(DEFAULT_SOURCES)}."
            ),
        )

    def handle(self, *args, **options):
        key = settings.FIRMS_MAP_KEY
        if not key:
            raise CommandError(
                "FIRMS_MAP_KEY is not set. Request a free key at "
                "https://firms.modaps.eosdis.nasa.gov/api/map_key/ "
                "and add it to your .env as FIRMS_MAP_KEY=..."
            )

        day_range = options["day_range"]
        if not 1 <= day_range <= 10:
            raise CommandError("--day-range must be between 1 and 10.")
        sources = options["source"]

        # The query area is source-independent, so compute it once up front.
        bbox = self._bbox()
        if bbox is None:
            raise CommandError(
                "No towers found — run 'python manage.py seed_towers' first so "
                "we know which area to query."
            )

        totals = {"fetched": 0, "created": 0, "updated": 0, "skipped": 0}
        failures = []
        for source in sources:
            try:
                counts = self._ingest_source(key, source, bbox, day_range)
            except (CommandError, requests.RequestException) as exc:
                # Isolate per-source failures: a throttled/erroring sensor must
                # not lose the detections the other sensors returned. Redact the
                # key, which requests embeds in its exception text.
                message = str(exc).replace(key, "***")
                self.stderr.write(
                    self.style.WARNING(f"  {source}: skipped — {message}")
                )
                failures.append(source)
                continue
            for field, value in counts.items():
                totals[field] += value
            self.stdout.write(
                f"  {source}: fetched {counts['fetched']}, "
                f"created {counts['created']}, updated {counts['updated']}, "
                f"skipped {counts['skipped']}."
            )

        succeeded = len(sources) - len(failures)
        if succeeded == 0:
            raise CommandError(
                f"All {len(sources)} FIRMS source(s) failed: "
                f"{', '.join(failures)}."
            )

        summary = (
            f"FIRMS ingest complete — {succeeded}/{len(sources)} source(s): "
            f"fetched {totals['fetched']}, created {totals['created']}, "
            f"updated {totals['updated']}, skipped {totals['skipped']}."
        )
        if failures:
            summary += f" Failed: {', '.join(failures)}."
        self.stdout.write(self.style.SUCCESS(summary))

    def _ingest_source(self, key, source, bbox, day_range):
        """Fetch + upsert one FIRMS source. Returns a counts dict; raises
        CommandError on a fetch/parse failure so the caller can isolate it."""
        west, south, east, north = bbox
        url = FIRMS_URL.format(
            key=key,
            source=source,
            bbox=f"{west},{south},{east},{north}",
            day_range=day_range,
        )
        # NB: don't log `url` — it embeds the secret MAP_KEY.
        self.stdout.write(
            f"Fetching {source} fires for bbox "
            f"({west:.3f}, {south:.3f}, {east:.3f}, {north:.3f}) "
            f"over {day_range} day(s)…"
        )

        try:
            response = requests.get(url, timeout=60)
            response.raise_for_status()
        except requests.RequestException as exc:
            # requests embeds the request URL (which contains the secret
            # MAP_KEY) in its exception text — redact it before surfacing.
            raise CommandError(
                f"FIRMS request failed: {str(exc).replace(key, '***')} "
                "(a large bounding box combined with a long --day-range can "
                "exceed FIRMS request limits — try a smaller --day-range)."
            )

        text = response.text
        first_line = text.splitlines()[0].strip().lower() if text.strip() else ""
        if "latitude" not in first_line:
            # FIRMS returns a plain-text message (bad key, throttled, etc.)
            # rather than CSV when something is wrong.
            raise CommandError(
                f"unexpected FIRMS response (not CSV): {text.strip()[:200]!r}"
            )

        df = pd.read_csv(io.StringIO(text))
        fetched = len(df)

        created = updated = skipped = 0
        for row in df.itertuples(index=False):
            try:
                fields = self._build_fields(row, source)
            except (TypeError, ValueError, ValidationError):
                skipped += 1
                continue
            # update_or_create on the stable external_uid is what makes
            # re-running the ingest idempotent (no duplicate rows).
            _, was_created = FireDetection.objects.update_or_create(
                external_uid=fields.pop("external_uid"),
                defaults=fields,
            )
            created += was_created
            updated += not was_created

        return {
            "fetched": fetched,
            "created": created,
            "updated": updated,
            "skipped": skipped,
        }

    @staticmethod
    def _bbox():
        """(west, south, east, north) envelope of all towers' coverage areas."""
        towers = list(WatchtowerSite.objects.all())
        if not towers:
            return None
        # Union the coverage polygons, then take the bounding box. Keeping the
        # bbox tight (towers' envelope, not "the world") respects FIRMS limits.
        union = reduce(
            lambda a, b: a.union(b),
            (tower.coverage_area() for tower in towers),
        )
        return union.envelope.extent  # (xmin, ymin, xmax, ymax)

    @staticmethod
    def _build_fields(row, source):
        # Validate the raw CSV row against our expected world view before mapping
        # it to a model: required geometry/time fields must be present + numeric,
        # optional measurements (frp, brightness) coerce NaN→None. A malformed row
        # raises ValidationError and is skipped by the caller.
        parsed = FirmsRow.model_validate(row._asdict())
        acq_time = parsed.acq_time_hhmm  # HHMM, sometimes unpadded (118 -> 0118).
        acquired_at = datetime.strptime(
            f"{parsed.acq_date} {acq_time}", "%Y-%m-%d %H%M"
        ).replace(tzinfo=timezone.utc)

        return {
            "external_uid": (
                f"{parsed.latitude:.5f}_{parsed.longitude:.5f}_"
                f"{parsed.acq_date}_{acq_time}_{source}"
            ),
            "location": Point(parsed.longitude, parsed.latitude, srid=4326),
            "acquired_at": acquired_at,
            "source": source,
            "frp": parsed.frp,
            "brightness": parsed.bright_ti4,
            "confidence": parsed.confidence,
        }
