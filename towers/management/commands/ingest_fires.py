"""Ingest VIIRS satellite fire detections from NASA FIRMS into ``FireDetection``.

Pulls the three near-real-time VIIRS sensors by default (NOAA-20, SNPP,
NOAA-21); a ``--start/--end`` pair switches to standard-processing archive
sources, chunked into 5-day windows to stay under FIRMS' bbox-area × days cap.

**Isolation model.** Sources and cluster bboxes are fetched independently. A
failed cluster bbox for a given source only loses that cluster, not the source;
a source only counts as failed if every bbox fails. Same with archive windows: a
single 400 response does not abort the whole backfill. The result is that a
transient FIRMS hiccup (throttle, empty tile, bad archive window) never silently
drops a whole sensor's data.

**Idempotent.** Re-running any ingest over an already-ingested window upserts on
``external_uid`` (lat/lon/time/source) and never creates duplicate rows.

**Security.** The FIRMS ``MAP_KEY`` is embedded in the request URL — never log
it. Any exception text from ``requests`` that might contain the URL is redacted
before surfacing.
"""

import io
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import requests
from django.conf import settings
from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError
from pydantic import ValidationError

from towers.clustering import cluster_bboxes
from towers.models import FireDetection, WatchtowerSite
from towers.schemas import FirmsRow

# FIRMS "area" endpoint: CSV detections within a bbox. The day-range suffix is
# "last N days"; appending a start date instead returns N days *from* that date.
FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{bbox}/{day_range}"

# VIIRS near-real-time sensors pulled by default. Each is a separate FIRMS
# request; widening coverage is as simple as adding a sensor to this list.
DEFAULT_SOURCES = [
    "VIIRS_NOAA20_NRT",
    "VIIRS_SNPP_NRT",
    "VIIRS_NOAA21_NRT",
]

# NRT sensors only retain ~2 months; the standard-processing archive sources
# cover older seasons, so a dated backfill (--start/--end) defaults to these.
DEFAULT_ARCHIVE_SOURCES = [
    "VIIRS_SNPP_SP",
    "VIIRS_NOAA20_SP",
]

# FIRMS caps a single area request by bbox-area × days (not just a 10-day max):
# over the towers' envelope, 10-day windows 400 but 5-day windows succeed, so a
# long backfill is chunked into 5-day windows to stay under the limit.
MAX_WINDOW_DAYS = 5


class Command(BaseCommand):
    help = (
        "Ingest VIIRS fire detections from NASA FIRMS for the bounding box "
        "covering the seeded towers. Pulls every default sensor; sources are "
        "isolated so one failing sensor never loses the others. Idempotent."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--day-range",
            type=int,
            default=1,
            help="How many days back to fetch (1-10). Default 1. Ignored in "
            "backfill mode (--start/--end).",
        )
        parser.add_argument(
            "--start",
            type=date.fromisoformat,
            default=None,
            help="Backfill start date, inclusive (YYYY-MM-DD). Requires --end; "
            "switches to the archive sources and chunks the range.",
        )
        parser.add_argument(
            "--end",
            type=date.fromisoformat,
            default=None,
            help="Backfill end date, inclusive (YYYY-MM-DD). Requires --start.",
        )
        parser.add_argument(
            "--source",
            nargs="+",
            default=None,
            help=(
                "FIRMS source/sensor(s) to pull, space-separated. Defaults to "
                f"the NRT sensors ({', '.join(DEFAULT_SOURCES)}); in backfill "
                f"mode defaults to the archive sources "
                f"({', '.join(DEFAULT_ARCHIVE_SOURCES)})."
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

        start, end = options["start"], options["end"]
        backfill = start is not None or end is not None
        if backfill:
            if start is None or end is None:
                raise CommandError("--start and --end must be given together.")
            if start > end:
                raise CommandError("--start must be on or before --end.")
            sources = options["source"] or DEFAULT_ARCHIVE_SOURCES
        else:
            day_range = options["day_range"]
            if not 1 <= day_range <= 10:
                raise CommandError("--day-range must be between 1 and 10.")
            sources = options["source"] or DEFAULT_SOURCES

        # The query area is source-independent, so compute it once up front.
        # Towers are clustered into tight per-region bboxes (FIRMS caps a request
        # by bbox-area × days); a single continent-spanning envelope would 400.
        result = self._bboxes()
        if result is None:
            raise CommandError(
                "No towers found — run 'python manage.py seed_towers' first so "
                "we know which area to query."
            )
        bboxes, oversized = result
        for bbox in oversized:
            self.stderr.write(
                self.style.WARNING(
                    f"  cluster bbox {bbox} exceeds the FIRMS size budget; it may "
                    "400 — consider tightening CLUSTER_LINK_DEGREES."
                )
            )

        totals = {"fetched": 0, "created": 0, "updated": 0, "skipped": 0}
        failures = []
        for source in sources:
            # A source is fetched once per cluster bbox. Accumulate its counts
            # and only mark it failed if *every* cluster fails (symmetric with
            # the per-window isolation inside _ingest_range).
            src_counts = {"fetched": 0, "created": 0, "updated": 0, "skipped": 0}
            cluster_failures = 0
            for bbox in bboxes:
                try:
                    if backfill:
                        counts = self._ingest_range(key, source, bbox, start, end)
                    else:
                        counts = self._ingest_source(key, source, bbox, day_range)
                except (CommandError, requests.RequestException) as exc:
                    # Isolate per-cluster failures: a throttled/erroring request
                    # for one region must not lose the others. Redact the key,
                    # which requests embeds in its exception text.
                    message = str(exc).replace(key, "***")
                    self.stderr.write(
                        self.style.WARNING(f"  {source} bbox {bbox}: skipped — {message}")
                    )
                    cluster_failures += 1
                    continue
                for field, value in counts.items():
                    src_counts[field] += value
            if cluster_failures == len(bboxes):
                failures.append(source)
                continue
            for field, value in src_counts.items():
                totals[field] += value
            self.stdout.write(
                f"  {source}: fetched {src_counts['fetched']}, "
                f"created {src_counts['created']}, updated {src_counts['updated']}, "
                f"skipped {src_counts['skipped']}."
            )

        succeeded = len(sources) - len(failures)
        if succeeded == 0:
            raise CommandError(f"All {len(sources)} FIRMS source(s) failed: {', '.join(failures)}.")

        summary = (
            f"FIRMS ingest complete — {succeeded}/{len(sources)} source(s): "
            f"fetched {totals['fetched']}, created {totals['created']}, "
            f"updated {totals['updated']}, skipped {totals['skipped']}."
        )
        if failures:
            summary += f" Failed: {', '.join(failures)}."
        self.stdout.write(self.style.SUCCESS(summary))

    def _ingest_source(self, key, source, bbox, day_range):
        """Fetch + upsert one FIRMS source over the last ``day_range`` days."""
        return self._fetch_and_upsert(key, source, bbox, day_range, start_date=None)

    def _ingest_range(self, key, source, bbox, start, end):
        """Backfill one source across ``start..end``, chunked to FIRMS' 10-day cap.

        Windows are isolated: a single window that 400s (a common archive
        hiccup) is logged and skipped rather than losing the whole season. The
        source only counts as failed if *every* window fails.
        """
        totals = {"fetched": 0, "created": 0, "updated": 0, "skipped": 0}
        windows = window_failures = 0
        cursor = start
        while cursor <= end:
            span = min(MAX_WINDOW_DAYS, (end - cursor).days + 1)
            windows += 1
            try:
                counts = self._fetch_and_upsert(key, source, bbox, span, cursor)
            except (CommandError, requests.RequestException) as exc:
                message = str(exc).replace(key, "***")
                self.stderr.write(
                    self.style.WARNING(f"    {source} {cursor}..+{span}d: skipped — {message}")
                )
                window_failures += 1
            else:
                for field, value in counts.items():
                    totals[field] += value
            cursor += timedelta(days=span)

        if window_failures == windows:
            raise CommandError(f"all {windows} window(s) failed for {source}")
        return totals

    def _fetch_and_upsert(self, key, source, bbox, day_range, start_date):
        """Fetch + upsert one FIRMS request. Returns a counts dict; raises
        CommandError on a fetch/parse failure so the caller can isolate it.

        ``start_date`` None → "last ``day_range`` days"; a date → ``day_range``
        days from that date (the archive/backfill form).
        """
        west, south, east, north = bbox
        url = FIRMS_URL.format(
            key=key,
            source=source,
            bbox=f"{west},{south},{east},{north}",
            day_range=day_range,
        )
        if start_date is not None:
            url = f"{url}/{start_date.isoformat()}"
        # NB: don't log `url` — it embeds the secret MAP_KEY.
        window = (
            f"from {start_date} over {day_range} day(s)"
            if start_date is not None
            else f"over the last {day_range} day(s)"
        )
        self.stdout.write(
            f"Fetching {source} fires for bbox "
            f"({west:.3f}, {south:.3f}, {east:.3f}, {north:.3f}) {window}…"
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
            raise CommandError(f"unexpected FIRMS response (not CSV): {text.strip()[:200]!r}")

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
    def _bboxes():
        """Per-cluster (west, south, east, north) bboxes covering all towers.

        Towers are grouped into spatially-tight clusters so each FIRMS query's
        bbox stays small (FIRMS caps a request by bbox-area × days); a single
        continent-spanning envelope would 400. Returns ``None`` if there are no
        towers, else ``(bboxes, oversized)`` — the cluster bboxes plus any whose
        span still exceeds the FIRMS budget (the caller warns on those).
        """
        towers = list(WatchtowerSite.objects.all())
        if not towers:
            return None
        return cluster_bboxes([tower.coverage_area() for tower in towers])

    @staticmethod
    def _build_fields(row, source):
        # Validate the raw CSV row against our expected world view before mapping
        # it to a model: required geometry/time fields must be present + numeric,
        # optional measurements (frp, brightness) coerce NaN→None. A malformed row
        # raises ValidationError and is skipped by the caller.
        parsed = FirmsRow.model_validate(row._asdict())
        acq_time = parsed.acq_time_hhmm  # HHMM, sometimes unpadded (118 -> 0118).
        acquired_at = datetime.strptime(f"{parsed.acq_date} {acq_time}", "%Y-%m-%d %H%M").replace(
            tzinfo=timezone.utc
        )

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
