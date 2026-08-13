"""Shared Open-Meteo constants and upsert helper for weather ingest commands.

Both ``ingest_weather`` and ``backfill_weather`` talk to Open-Meteo endpoints
that return the same ``daily`` payload shape. This module holds the single
source of truth for the variable list and source tag, plus the
``upsert_observations`` helper that maps validated ``WeatherDay`` DTOs to
``WeatherObservation`` rows.

The Pydantic boundary (``OpenMeteoResponse`` / ``to_weather_days``) lives in
``towers.schemas`` and is *not* repeated here — callers validate first, then
hand the resulting list of ``WeatherDay`` objects to this module.
"""

from towers.models import WatchtowerSite, WeatherObservation
from towers.schemas import WeatherDay

# The Open-Meteo ``daily`` fields we request. Order here must match the field
# names expected by ``OpenMeteoResponse``'s ``_OpenMeteoDaily`` validator.
DAILY_VARS: tuple[str, ...] = (
    "temperature_2m_max",
    "relative_humidity_2m_min",
    "wind_speed_10m_max",
    "precipitation_sum",
    "snow_depth_max",
)

# Source tag written to ``WeatherObservation.source`` for every row from either
# the forecast or archive endpoint.
SOURCE: str = "open-meteo"


def upsert_observations(
    tower: WatchtowerSite,
    weather_days: list[WeatherDay],
) -> dict[str, int]:
    """Upsert a list of validated ``WeatherDay`` DTOs for one tower.

    Each row is keyed on ``external_uid = "<tower_id>_<date>_<SOURCE>"`` so
    re-ingesting the same date window is idempotent — no duplicates are created.

    Returns ``{"created": int, "updated": int}`` so callers can accumulate
    totals across towers without knowing the upsert internals.
    """
    created = updated = 0
    for day in weather_days:
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
