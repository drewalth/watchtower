"""Pure feature/label assembly for the ignition model (no DB / no network)."""

from datetime import date, timedelta

from towers.ml.dataset import (
    DEFAULT_HORIZON_DAYS,
    ROLLING_WINDOW_DAYS,
    StaticContext,
    TowerDay,
    assemble,
    label_for,
)

CONTEXT = StaticContext(fuel_type="conifer", elevation_m=1500.0, latitude=39.0)


def _day(d: date, *, temp=20.0, precip=0.0, fwi=10.0) -> TowerDay:
    """A TowerDay with sensible defaults; override the fields a test cares about."""
    return TowerDay(
        date=d,
        temp_c=temp,
        rh_pct=30.0,
        wind_kph=15.0,
        precip_24h_mm=precip,
        snow_depth_cm=0.0,
        ffmc=88.0,
        dmc=20.0,
        dc=150.0,
        isi=8.0,
        bui=25.0,
        fwi=fwi,
        risk_score=40.0,
    )


def _run(start: date, n: int, **per_day):
    """``n`` consecutive days from ``start``; ``per_day`` overrides every day."""
    return [_day(start + timedelta(days=i), **per_day) for i in range(n)]


# --- labeling -------------------------------------------------------------


def test_label_one_when_fire_inside_horizon():
    t = date(2025, 7, 1)
    fires = {t + timedelta(days=2)}  # day t+2, inside (t, t+3]
    assert label_for(t, fires, DEFAULT_HORIZON_DAYS) == 1


def test_label_zero_when_fire_beyond_horizon():
    t = date(2025, 7, 1)
    fires = {t + timedelta(days=DEFAULT_HORIZON_DAYS + 1)}  # just past the window
    assert label_for(t, fires, DEFAULT_HORIZON_DAYS) == 0


def test_label_excludes_same_day_fire():
    t = date(2025, 7, 1)
    # A detection ON day t is not a prediction — the window is open at t.
    assert label_for(t, {t}, DEFAULT_HORIZON_DAYS) == 0


def test_assemble_labels_track_the_fire_calendar():
    days = _run(date(2025, 7, 1), 6)
    # Fire on the 5th → days whose (t, t+3] window includes the 5th are positive.
    fires = {date(2025, 7, 5)}
    labels = {s.date: s.label for s in assemble(CONTEXT, days, fires)}
    assert labels[date(2025, 7, 2)] == 1  # 7/2 .. window covers 7/5
    assert labels[date(2025, 7, 4)] == 1  # 7/4 .. 7/5 is t+1
    assert labels[date(2025, 7, 1)] == 0  # 7/1 .. window is 7/2-7/4, misses 7/5
    assert labels[date(2025, 7, 5)] == 0  # same-day excluded, nothing after


# --- rolling features -----------------------------------------------------


def test_rolling_aggregates_use_trailing_window():
    # Seven days of known temps/precip; check the last day's aggregates.
    days = [
        _day(date(2025, 7, 1) + timedelta(days=i), temp=10.0 + i, precip=2.0)
        for i in range(ROLLING_WINDOW_DAYS)
    ]
    last = assemble(CONTEXT, days, set())[-1].features
    assert last["temp_7d_mean"] == sum(10.0 + i for i in range(7)) / 7
    assert last["precip_7d_sum"] == 2.0 * 7


def test_days_since_rain_counts_back_to_last_wetting_rain():
    days = _run(date(2025, 7, 1), 5, precip=0.0)
    days[2] = _day(days[2].date, precip=5.0)  # rain three days before the last
    last = assemble(CONTEXT, days, set())[-1].features
    assert last["days_since_rain"] == 2.0  # indices 4 -> 2 is two days back


# --- leakage guard --------------------------------------------------------


def test_features_do_not_depend_on_future_days_or_labels():
    """Features at day t are identical no matter what happens after t."""
    base = _run(date(2025, 7, 1), 5)
    extended = base + _run(date(2025, 7, 6), 5, temp=99.0, precip=99.0)

    short = assemble(CONTEXT, base, set())
    long = assemble(CONTEXT, extended, {date(2025, 7, 7)})

    # The first five days' feature vectors must match exactly — nothing from the
    # appended future (or the fire calendar) may leak backwards into them.
    for a, b in zip(short, long):
        assert a.features == b.features
