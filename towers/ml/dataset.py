"""Feature/label assembly for the ignition-probability model — pure, no I/O.

The management command does the DB/spatial work (pulling each tower's daily
weather + FWI rows and the calendar dates on which a detection landed inside its
coverage) and hands plain data to ``assemble``. This module turns one tower's
ordered day records into ``(features, label)`` samples.

**Framing.** For a tower-day ``t`` the label is 1 iff at least one fire detection
falls inside the tower's coverage during ``(t, t + horizon]``. Every feature is
computed only from days ``<= t`` (the structural leakage guard: ``assemble``
passes each day a *history* slice ending at that day, so a feature physically
cannot read the future window that defines its label).
"""

import math
from dataclasses import dataclass, field
from datetime import date, timedelta

# Default early-warning lead time: a fire within the next three days.
DEFAULT_HORIZON_DAYS = 3
# Rolling-aggregate window (days, inclusive of the current day).
ROLLING_WINDOW_DAYS = 7
# A "wetting rain" — used for days-since-rain. Below this, fuels keep drying.
RAIN_THRESHOLD_MM = 1.0
# Days in the seasonal cycle for the cyclical day-of-year encoding.
_DAYS_PER_YEAR = 365.25

# The numeric model features, in a stable order. Categorical fuel_type is encoded
# separately by the sklearn pipeline (see towers/ml/model.py), so it is not here.
NUMERIC_FEATURES = (
    "temp_c",
    "rh_pct",
    "wind_kph",
    "precip_24h_mm",
    "snow_depth_cm",
    "ffmc",
    "dmc",
    "dc",
    "isi",
    "bui",
    "fwi",
    "risk_score",
    "temp_7d_mean",
    "precip_7d_sum",
    "days_since_rain",
    "elevation_m",
    "latitude",
    "doy_sin",
    "doy_cos",
)
CATEGORICAL_FEATURES = ("fuel_type",)
# The single-feature column the FWI-only baseline classifier trains on.
BASELINE_FEATURE = "fwi"


@dataclass(frozen=True)
class TowerDay:
    """One tower-day of weather + computed FWI codes (the per-day inputs)."""

    date: date
    temp_c: float
    rh_pct: float
    wind_kph: float
    precip_24h_mm: float
    snow_depth_cm: float
    ffmc: float
    dmc: float
    dc: float
    isi: float
    bui: float
    fwi: float
    risk_score: float


@dataclass(frozen=True)
class StaticContext:
    """Per-tower features that don't change day to day."""

    fuel_type: str
    elevation_m: float
    latitude: float


@dataclass(frozen=True)
class Sample:
    """One assembled training/inference row."""

    date: date
    features: dict = field(default_factory=dict)
    label: int | None = None


def label_for(day: date, fire_dates: set[date], horizon_days: int) -> int:
    """1 iff any in-coverage detection falls in the window ``(day, day+horizon]``.

    The window is open at ``day`` (a same-day fire is not a *prediction*) and
    closed at the horizon end.
    """
    for offset in range(1, horizon_days + 1):
        if day + timedelta(days=offset) in fire_dates:
            return 1
    return 0


def _rolling_features(history: list[TowerDay]) -> dict:
    """Aggregates over the trailing ``ROLLING_WINDOW_DAYS`` (history ends today).

    ``history`` is ordered oldest→newest and ends at the current day, so every
    value here is knowable at prediction time.
    """
    window = history[-ROLLING_WINDOW_DAYS:]
    temp_7d_mean = sum(d.temp_c for d in window) / len(window)
    precip_7d_sum = sum(d.precip_24h_mm for d in window)

    # Days since the last wetting rain, scanning back from today. Capped at the
    # window length so an arbitrarily long dry spell stays a bounded feature.
    days_since_rain = float(ROLLING_WINDOW_DAYS)
    for back, day in enumerate(reversed(history[-ROLLING_WINDOW_DAYS:])):
        if day.precip_24h_mm >= RAIN_THRESHOLD_MM:
            days_since_rain = float(back)
            break

    return {
        "temp_7d_mean": temp_7d_mean,
        "precip_7d_sum": precip_7d_sum,
        "days_since_rain": days_since_rain,
    }


def _seasonality(day: date) -> dict:
    """Cyclical day-of-year encoding so Dec 31 and Jan 1 sit next to each other."""
    angle = 2.0 * math.pi * (day.timetuple().tm_yday / _DAYS_PER_YEAR)
    return {"doy_sin": math.sin(angle), "doy_cos": math.cos(angle)}


def build_features(history: list[TowerDay], context: StaticContext) -> dict:
    """Feature dict for the *last* day in ``history`` (uses only days ≤ that day)."""
    today = history[-1]
    return {
        "temp_c": today.temp_c,
        "rh_pct": today.rh_pct,
        "wind_kph": today.wind_kph,
        "precip_24h_mm": today.precip_24h_mm,
        "snow_depth_cm": today.snow_depth_cm,
        "ffmc": today.ffmc,
        "dmc": today.dmc,
        "dc": today.dc,
        "isi": today.isi,
        "bui": today.bui,
        "fwi": today.fwi,
        "risk_score": today.risk_score,
        "elevation_m": context.elevation_m,
        "latitude": context.latitude,
        "fuel_type": context.fuel_type,
        **_rolling_features(history),
        **_seasonality(today.date),
    }


def assemble(
    context: StaticContext,
    days: list[TowerDay],
    fire_dates: set[date],
    horizon_days: int = DEFAULT_HORIZON_DAYS,
) -> list[Sample]:
    """One tower's ordered days → labeled samples (features known at ``t``).

    ``days`` must be sorted oldest→newest. ``fire_dates`` is the set of calendar
    days on which ≥1 detection landed in this tower's coverage (the caller runs
    the spatial query). Each sample's features come only from ``days[:i+1]``, so
    no feature can see the ``(t, t+horizon]`` window that defines its label.
    """
    samples = []
    for i, day in enumerate(days):
        history = days[: i + 1]
        samples.append(
            Sample(
                date=day.date,
                features=build_features(history, context),
                label=label_for(day.date, fire_dates, horizon_days),
            )
        )
    return samples
