from django.core.management.base import BaseCommand, CommandError

from towers.fire_weather import (
    STARTUP_CODES,
    apply_snow,
    daily_fwi,
    is_snow_covered,
    to_risk,
)
from towers.models import FireRiskAssessment, RiskLevel, WatchtowerSite
from towers.schemas import WeatherDay


class Command(BaseCommand):
    help = (
        "Compute the Canadian FWI System indices + a fire-risk rating for each "
        "tower by walking its daily WeatherObservations in order (the moisture "
        "codes are recursive, so each day builds on the previous). Snow-covered "
        "days are suppressed to zero risk. Idempotent."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--tower", type=int, default=None,
            help="Only compute for this tower id (default: all towers).",
        )

    def handle(self, *args, **options):
        towers = WatchtowerSite.objects.all()
        if options["tower"] is not None:
            towers = towers.filter(pk=options["tower"])
        towers = list(towers)
        if not towers:
            raise CommandError(
                "No matching towers — run 'python manage.py seed_towers' first."
            )

        totals = {"created": 0, "updated": 0}
        for tower in towers:
            counts = self._compute_tower(tower)
            for field, value in counts.items():
                totals[field] += value
            self.stdout.write(
                f"  {tower.name}: created {counts['created']}, "
                f"updated {counts['updated']}."
            )

        self.stdout.write(self.style.SUCCESS(
            f"Fire-risk computed — created {totals['created']}, "
            f"updated {totals['updated']}."
        ))

    def _compute_tower(self, tower):
        """Walk this tower's weather forward, carrying the recursive codes."""
        observations = tower.weather.order_by("date")
        prev = STARTUP_CODES
        created = updated = 0

        for obs in observations:
            if is_snow_covered(obs.snow_depth_cm):
                # Fuels saturated → suppress risk and over-winter the codes so the
                # season restarts cleanly once the snow melts.
                prev = apply_snow(prev, obs.snow_depth_cm)
                fields = {
                    "ffmc": prev.ffmc, "dmc": prev.dmc, "dc": prev.dc,
                    "isi": 0.0, "bui": 0.0, "fwi": 0.0,
                    "risk_score": 0.0, "risk_level": RiskLevel.LOW,
                    "snow_covered": True,
                }
            else:
                weather = WeatherDay(
                    date=obs.date,
                    temp_c=obs.temp_c,
                    rh_pct=obs.rh_pct,
                    wind_kph=obs.wind_kph,
                    precip_24h_mm=obs.precip_24h_mm,
                    snow_depth_cm=obs.snow_depth_cm,
                )
                result = daily_fwi(prev, weather)
                score, level = to_risk(result.fwi, tower.fuel_factor)
                prev = result.codes
                fields = {
                    "ffmc": result.ffmc, "dmc": result.dmc, "dc": result.dc,
                    "isi": result.isi, "bui": result.bui, "fwi": result.fwi,
                    "risk_score": score, "risk_level": level,
                    "snow_covered": False,
                }

            _, was_created = FireRiskAssessment.objects.update_or_create(
                tower=tower, date=obs.date, defaults=fields,
            )
            created += was_created
            updated += not was_created

        return {"created": created, "updated": updated}
