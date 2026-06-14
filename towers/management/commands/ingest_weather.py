import requests
from django.core.management.base import BaseCommand, CommandError
from pydantic import ValidationError

from towers.models import WatchtowerSite, WeatherObservation
from towers.schemas import OpenMeteoResponse

# Open-Meteo forecast endpoint. Free, no API key. We request one daily block
# carrying every FWI input (noon-proxy temp/RH/wind, 24h precip) plus snow depth.
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
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
        "Ingest daily weather (the Canadian FWI inputs) per tower from Open-Meteo. "
        "Towers are isolated so one failing/invalid response never loses the "
        "others. Responses are validated at the boundary before any write. "
        "Idempotent."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--day-range", type=int, default=7,
            help="How many past days to fetch (1-92), plus today. Default 7.",
        )
        parser.add_argument(
            "--tower", type=int, default=None,
            help="Only ingest for this tower id (default: all towers).",
        )

    def handle(self, *args, **options):
        day_range = options["day_range"]
        if not 1 <= day_range <= 92:
            raise CommandError("--day-range must be between 1 and 92.")

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
                counts = self._ingest_tower(tower, day_range)
            except (CommandError, requests.RequestException, ValidationError) as exc:
                # Isolate per-tower failures: a network hiccup or a payload that
                # no longer matches our world view must not lose the other towers.
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
            f"Weather ingest complete — {succeeded}/{len(towers)} tower(s): "
            f"created {totals['created']}, updated {totals['updated']}."
        )
        if failures:
            summary += f" Failed: {', '.join(failures)}."
        self.stdout.write(self.style.SUCCESS(summary))

    def _ingest_tower(self, tower, day_range):
        """Fetch + validate + upsert one tower's weather. Returns counts."""
        params = {
            "latitude": tower.location.y,
            "longitude": tower.location.x,
            "daily": ",".join(DAILY_VARS),
            "timezone": "auto",
            "wind_speed_unit": "kmh",
            "past_days": day_range,
            "forecast_days": 1,
        }
        response = requests.get(OPEN_METEO_URL, params=params, timeout=60)
        response.raise_for_status()

        # Validate the third-party payload against our expected shape *before*
        # anything touches the DB — a renamed/dropped field or a null where we
        # expect a number raises ValidationError, caught and isolated above.
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
