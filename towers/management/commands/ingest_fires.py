import io
from datetime import datetime, timezone
from functools import reduce

import pandas as pd
import requests
from django.conf import settings
from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError

from towers.models import FireDetection, WatchtowerSite

# FIRMS "area" endpoint: CSV detections within a bbox over the last N days.
FIRMS_URL = (
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
    "{key}/{source}/{bbox}/{day_range}"
)


def _nullable_float(value):
    """Coerce a CSV cell to float, or None for blanks/NaN/garbage."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if pd.isna(number) else number


class Command(BaseCommand):
    help = (
        "Ingest VIIRS fire detections from NASA FIRMS for the bounding box "
        "covering the seeded towers. Idempotent — safe to re-run."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--day-range", type=int, default=1,
            help="How many days back to fetch (1-10). Default 1.",
        )
        parser.add_argument(
            "--source", default="VIIRS_NOAA20_NRT",
            help="FIRMS source/sensor. Default VIIRS_NOAA20_NRT.",
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
        source = options["source"]

        bbox = self._bbox()
        if bbox is None:
            raise CommandError(
                "No towers found — run 'python manage.py seed_towers' first so "
                "we know which area to query."
            )
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
                f"FIRMS request failed: {str(exc).replace(key, '***')}\n"
                "(A large bounding box combined with a long --day-range can "
                "exceed FIRMS request limits — try a smaller --day-range.)"
            )

        text = response.text
        first_line = text.splitlines()[0].strip().lower() if text.strip() else ""
        if "latitude" not in first_line:
            # FIRMS returns a plain-text message (bad key, throttled, etc.)
            # rather than CSV when something is wrong.
            raise CommandError(
                f"Unexpected FIRMS response (not CSV): {text.strip()[:200]!r}"
            )

        df = pd.read_csv(io.StringIO(text))
        fetched = len(df)

        created = updated = skipped = 0
        for row in df.itertuples(index=False):
            try:
                fields = self._build_fields(row, source)
            except (TypeError, ValueError):
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

        self.stdout.write(
            self.style.SUCCESS(
                f"FIRMS ingest complete — fetched {fetched}, created {created}, "
                f"updated {updated}, skipped {skipped}."
            )
        )

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
        lat = float(row.latitude)
        lon = float(row.longitude)
        acq_date = str(row.acq_date)
        # FIRMS acq_time is HHMM, sometimes unpadded (e.g. 118 -> 01:18 UTC).
        acq_time = str(row.acq_time).zfill(4)
        acquired_at = datetime.strptime(
            f"{acq_date} {acq_time}", "%Y-%m-%d %H%M"
        ).replace(tzinfo=timezone.utc)

        return {
            "external_uid": f"{lat:.5f}_{lon:.5f}_{acq_date}_{acq_time}_{source}",
            "location": Point(lon, lat, srid=4326),
            "acquired_at": acquired_at,
            "source": source,
            "frp": _nullable_float(getattr(row, "frp", None)),
            "brightness": _nullable_float(getattr(row, "bright_ti4", None)),
            "confidence": str(getattr(row, "confidence", "")),
        }
