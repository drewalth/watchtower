"""Pydantic schemas validating third-party data at the ingest boundary.

External payloads (Open-Meteo JSON, FIRMS CSV rows) are parsed through these
models *before* anything reaches the DB, so a renamed field, an unexpected null,
or a mismatched array raises a precise ``ValidationError`` instead of silently
persisting garbage. The validated DTOs are the single source of truth for what a
"good" weather day / fire row looks like downstream.
"""
import math
from datetime import date

from pydantic import BaseModel, field_validator, model_validator

# How many centimetres in a metre — Open-Meteo reports snow depth in metres.
_CM_PER_M = 100.0


class WeatherDay(BaseModel):
    """One validated tower-day of the FWI noon inputs (our domain DTO)."""

    date: date
    temp_c: float
    rh_pct: float
    wind_kph: float
    precip_24h_mm: float
    snow_depth_cm: float


class _OpenMeteoDaily(BaseModel):
    """The Open-Meteo ``daily`` block: parallel arrays keyed positionally by date."""

    time: list[date]
    temperature_2m_max: list[float]
    relative_humidity_2m_min: list[float]
    wind_speed_10m_max: list[float]
    precipitation_sum: list[float]
    snow_depth_max: list[float]  # metres

    @model_validator(mode="after")
    def _arrays_align_with_time(self):
        n = len(self.time)
        for name in (
            "temperature_2m_max",
            "relative_humidity_2m_min",
            "wind_speed_10m_max",
            "precipitation_sum",
            "snow_depth_max",
        ):
            if len(getattr(self, name)) != n:
                raise ValueError(
                    f"daily.{name} has {len(getattr(self, name))} values, "
                    f"expected {n} to match daily.time"
                )
        return self


class OpenMeteoResponse(BaseModel):
    """A validated Open-Meteo forecast response (only the fields we rely on)."""

    latitude: float
    longitude: float
    daily: _OpenMeteoDaily

    def to_weather_days(self) -> list[WeatherDay]:
        """Flatten the parallel daily arrays into per-day domain DTOs."""
        d = self.daily
        return [
            WeatherDay(
                date=day,
                temp_c=temp,
                rh_pct=rh,
                wind_kph=wind,
                precip_24h_mm=precip,
                snow_depth_cm=snow_m * _CM_PER_M,
            )
            for day, temp, rh, wind, precip, snow_m in zip(
                d.time,
                d.temperature_2m_max,
                d.relative_humidity_2m_min,
                d.wind_speed_10m_max,
                d.precipitation_sum,
                d.snow_depth_max,
            )
        ]


def _nan_to_none(value: object) -> object:
    """NaN/blank → None; pandas yields NaN floats for missing CSV cells."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return value


class FirmsRow(BaseModel):
    """One validated FIRMS CSV detection row.

    Replaces the ad-hoc ``_nullable_float`` coercion: required geometry/time
    fields must be present and numeric; optional measurements coerce NaN→None.
    """

    latitude: float
    longitude: float
    acq_date: str
    acq_time: int
    confidence: str = ""
    frp: float | None = None
    bright_ti4: float | None = None

    @field_validator("acq_date", mode="before")
    @classmethod
    def _stringify_date(cls, value):
        return str(value)

    @field_validator("acq_time", mode="before")
    @classmethod
    def _coerce_time(cls, value):
        # pandas itertuples yields numpy.int64 (not a Python int); FIRMS may also
        # send it as a string. Normalise to a plain int (HHMM).
        return int(value)

    @field_validator("confidence", mode="before")
    @classmethod
    def _confidence_default(cls, value):
        cleaned = _nan_to_none(value)
        return "" if cleaned is None else str(cleaned)

    @field_validator("frp", "bright_ti4", mode="before")
    @classmethod
    def _nullable_measurement(cls, value):
        return _nan_to_none(value)

    @property
    def acq_time_hhmm(self) -> str:
        """FIRMS acq_time is HHMM, sometimes unpadded (118 → ``0118``)."""
        return str(self.acq_time).zfill(4)
