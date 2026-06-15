"""Backfill historical weather per tower from the Open-Meteo *archive* API.

A one-time bootstrap for Phase 5: the hourly scheduler only accumulates data
going forward, but training needs months of history. This reaches back over a
date range and upserts the same WeatherObservation rows ingest_weather writes —
so compute_fire_risk can then walk the FWI codes across the full backfilled span.

Reuses the Phase 4 boundary: the archive response has the same ``daily`` shape as
the forecast endpoint, so OpenMeteoResponse validates it unchanged. Per-tower
isolation + idempotent upsert mirror ingest_weather.
"""
from datetime import date

import requests
from django.core.management.base import BaseCommand, CommandError
from pydantic import ValidationError

from towers.models import WatchtowerSite, WeatherObservation
from towers.schemas import OpenMeteoResponse

# Open-Meteo historical reanalysis. Free, no API key; reaches back decades.
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
DAILY_VARS = (
    "temperature_2m_max",
    "relative_humidity_2m_min",
    "wind_speed_10m_max",
    "precipitation_sum",
    "snow_depth_max",
)
SOURCE = "open-meteo"


class Command(BaseCommand):
    help = (
        "Backfill historical daily weather (the FWI inputs) per tower from the "
        "Open-Meteo archive over a --start/--end date range. Towers are isolated; "
        "responses are validated at the boundary before any write. Idempotent."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--start", type=date.fromisoformat, required=True,
            help="First day to backfill, inclusive (YYYY-MM-DD).",
        )
        parser.add_argument(
            "--end", type=date.fromisoformat, required=True,
            help="Last day to backfill, inclusive (YYYY-MM-DD).",
        )
        parser.add_argument(
            "--tower", type=int, default=None,
            help="Only backfill for this tower id (default: all towers).",
        )

    def handle(self, *args, **options):
        start, end = options["start"], options["end"]
        if start > end:
            raise CommandError("--start must be on or before --end.")

        towers = WatchtowerSite.objects.all()
        if options["tower"] is not None:
            towers = towers.filter(pk=options["tower"])
        towers = list(towers)
        if not towers:
            raise CommandError(
                "No matching towers — run 'python manage.py seed_towers' first."
            )

        totals = {"created": 0, "updated": 0}
        failures = []
        for tower in towers:
            try:
                counts = self._backfill_tower(tower, start, end)
            except (CommandError, requests.RequestException, ValidationError) as exc:
                # Isolate per-tower failures so one bad response keeps the rest.
                self.stderr.write(
                    self.style.WARNING(f"  {tower.name}: skipped — {exc}")
                )
                failures.append(tower.name)
                continue
            for field, value in counts.items():
                totals[field] += value
            self.stdout.write(
                f"  {tower.name}: created {counts['created']}, "
                f"updated {counts['updated']}."
            )

        succeeded = len(towers) - len(failures)
        if succeeded == 0:
            raise CommandError(
                f"All {len(towers)} tower(s) failed: {', '.join(failures)}."
            )

        summary = (
            f"Weather backfill complete ({start}..{end}) — "
            f"{succeeded}/{len(towers)} tower(s): "
            f"created {totals['created']}, updated {totals['updated']}."
        )
        if failures:
            summary += f" Failed: {', '.join(failures)}."
        self.stdout.write(self.style.SUCCESS(summary))

    def _backfill_tower(self, tower, start, end):
        """Fetch + validate + upsert one tower's archive window. Returns counts."""
        params = {
            "latitude": tower.location.y,
            "longitude": tower.location.x,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "daily": ",".join(DAILY_VARS),
            "timezone": "auto",
            "wind_speed_unit": "kmh",
        }
        response = requests.get(ARCHIVE_URL, params=params, timeout=120)
        response.raise_for_status()

        # Same boundary validation as ingest_weather: a renamed/dropped field or a
        # null where a number is expected raises ValidationError, caught above.
        parsed = OpenMeteoResponse.model_validate(response.json())

        created = updated = 0
        for day in parsed.to_weather_days():
            uid = f"{tower.id}_{day.date.isoformat()}_{SOURCE}"
            _, was_created = WeatherObservation.objects.update_or_create(
                external_uid=uid,
                defaults={
                    "tower": tower,
                    "date": day.date,
                    "temp_c": day.temp_c,
                    "rh_pct": day.rh_pct,
                    "wind_kph": day.wind_kph,
                    "precip_24h_mm": day.precip_24h_mm,
                    "snow_depth_cm": day.snow_depth_cm,
                    "source": SOURCE,
                },
            )
            created += was_created
            updated += not was_created

        return {"created": created, "updated": updated}
