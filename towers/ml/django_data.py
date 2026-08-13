"""The Django/DB bridge between the ORM and the pure ``dataset`` assembly.

This is the one I/O-aware module in ``towers/ml`` (``dataset.py`` and
``model.py`` stay pure). It joins each tower's ``WeatherObservation`` and
``FireRiskAssessment`` rows by date into ``TowerDay`` records, derives the
in-coverage fire calendar from the existing spatial query, and hands the result
to ``dataset.assemble`` — so training labels use the *same* coverage definition
as the rest of the app.
"""

from dataclasses import dataclass
from datetime import date

from towers.models import WatchtowerSite

from .dataset import (
    DEFAULT_HORIZON_DAYS,
    StaticContext,
    TowerDay,
    assemble,
    build_features,
)


@dataclass(frozen=True)
class LabeledRows:
    """Assembled samples tagged with their tower — ready to split + train."""

    records: list[dict]
    labels: list[int]
    dates: list[date]
    tower_ids: list[int]


def tower_context(tower: WatchtowerSite) -> StaticContext:
    return StaticContext(
        fuel_type=tower.fuel_type,
        elevation_m=tower.elevation_m,
        latitude=tower.location.y,
    )


def tower_days(tower: WatchtowerSite) -> list[TowerDay]:
    """One tower's weather joined to its FWI codes, by date, oldest→newest.

    Only days with *both* a weather observation and a computed risk assessment
    are kept (the model needs the full feature row).
    """
    assessments = {a.date: a for a in tower.risk_assessments.all()}
    days = []
    for obs in tower.weather.order_by("date"):
        a = assessments.get(obs.date)
        if a is None:
            continue
        days.append(
            TowerDay(
                date=obs.date,
                temp_c=obs.temp_c,
                rh_pct=obs.rh_pct,
                wind_kph=obs.wind_kph,
                precip_24h_mm=obs.precip_24h_mm,
                snow_depth_cm=obs.snow_depth_cm,
                ffmc=a.ffmc,
                dmc=a.dmc,
                dc=a.dc,
                isi=a.isi,
                bui=a.bui,
                fwi=a.fwi,
                risk_score=a.risk_score,
            )
        )
    return days


def tower_fire_dates(tower: WatchtowerSite) -> set[date]:
    """Calendar days on which ≥1 detection landed in this tower's coverage.

    Reuses ``fires_in_range`` (viewshed-intersects or radius), so the label's
    notion of "in range" matches the map. ``acquired_at`` is UTC; we bucket by
    its UTC date — a one-day approximation against the tower's local weather day
    that is immaterial at this resolution.
    """
    return {f.acquired_at.date() for f in tower.fires_in_range()}


def assemble_all(
    towers: list[WatchtowerSite], horizon_days: int = DEFAULT_HORIZON_DAYS
) -> LabeledRows:
    """Assemble labeled samples across every tower for training."""
    records, labels, dates, tower_ids = [], [], [], []
    for tower in towers:
        context = tower_context(tower)
        days = tower_days(tower)
        if not days:
            continue
        fire_dates = tower_fire_dates(tower)
        for sample in assemble(context, days, fire_dates, horizon_days):
            records.append(sample.features)
            labels.append(sample.label)
            dates.append(sample.date)
            tower_ids.append(tower.id)
    return LabeledRows(records, labels, dates, tower_ids)


def latest_feature_row(tower: WatchtowerSite) -> tuple[date, dict] | None:
    """The (date, features) for this tower's most recent fully-populated day.

    What ``predict_ignition`` scores today. Returns None if the tower has no day
    with both weather and a risk assessment yet.
    """
    days = tower_days(tower)
    if not days:
        return None
    return days[-1].date, build_features(days, tower_context(tower))
