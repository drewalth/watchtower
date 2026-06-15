"""Time-window filtering on the fires feed + the dashboard aggregate endpoints."""
from datetime import date, datetime, timezone

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse

from towers.models import (
    FireDetection,
    FireRiskAssessment,
    IgnitionPrediction,
    WatchtowerSite,
)


def _dt(y, m, d):
    return datetime(y, m, d, 12, 0, tzinfo=timezone.utc)


def _fire(uid, lon, lat, *, when, source="VIIRS_NOAA20_NRT", frp=None):
    return FireDetection.objects.create(
        external_uid=uid,
        location=Point(lon, lat, srid=4326),
        acquired_at=when,
        source=source,
        confidence="n",
        frp=frp,
    )


def _assessment(tower, day, score):
    return FireRiskAssessment.objects.create(
        tower=tower, date=day, risk_level="moderate", risk_score=score,
        ffmc=88.0, dmc=20.0, dc=150.0, isi=8.0, bui=25.0, fwi=15.0, snow_covered=False,
    )


@pytest.fixture
def tower(db):
    return WatchtowerSite.objects.create(
        name="Analytics Tower",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1500,
        coverage_radius_km=20.0,
    )


# --- fires_geojson filtering -------------------------------------------------

@pytest.mark.django_db
def test_fires_geojson_filters_by_date_window(client):
    _fire("jun", -120.0, 38.1, when=_dt(2024, 6, 15))
    _fire("jul", -120.0, 38.1, when=_dt(2024, 7, 15))
    _fire("aug", -120.0, 38.1, when=_dt(2024, 8, 15))

    url = reverse("fires-geojson") + "?start=2024-07-01&end=2024-07-31"
    data = client.get(url).json()
    assert len(data["features"]) == 1
    assert data["features"][0]["properties"]["acquired_at"].startswith("2024-07-15")


@pytest.mark.django_db
def test_fires_geojson_filters_by_source(client):
    _fire("n20", -120.0, 38.1, when=_dt(2024, 7, 1), source="VIIRS_NOAA20_NRT")
    _fire("snpp", -120.0, 38.1, when=_dt(2024, 7, 1), source="VIIRS_SNPP_NRT")

    data = client.get(reverse("fires-geojson") + "?source=VIIRS_SNPP_NRT").json()
    assert len(data["features"]) == 1
    assert data["features"][0]["properties"]["source"] == "VIIRS_SNPP_NRT"


@pytest.mark.django_db
def test_fires_geojson_no_params_returns_all(client):
    _fire("a", -120.0, 38.1, when=_dt(2024, 6, 15))
    _fire("b", -120.0, 38.1, when=_dt(2025, 1, 1))
    assert len(client.get(reverse("fires-geojson")).json()["features"]) == 2


@pytest.mark.django_db
def test_fires_geojson_ignores_malformed_date(client):
    """A bad ?start= is ignored rather than 500ing — defensive on user input."""
    _fire("a", -120.0, 38.1, when=_dt(2024, 6, 15))
    data = client.get(reverse("fires-geojson") + "?start=not-a-date").json()
    assert len(data["features"]) == 1


# --- fires_timeseries --------------------------------------------------------

@pytest.mark.django_db
def test_fires_timeseries_counts_per_day_and_source(client):
    _fire("a", -120.0, 38.1, when=_dt(2024, 6, 1), source="VIIRS_NOAA20_NRT")
    _fire("b", -120.0, 38.1, when=_dt(2024, 6, 1), source="VIIRS_NOAA20_NRT")
    _fire("c", -120.0, 38.1, when=_dt(2024, 6, 1), source="VIIRS_SNPP_NRT")
    _fire("d", -120.0, 38.1, when=_dt(2024, 6, 3), source="VIIRS_NOAA20_NRT")

    data = client.get(reverse("fires-timeseries")).json()
    assert data["min_date"] == "2024-06-01"
    assert data["max_date"] == "2024-06-03"
    by_key = {(r["date"], r["source"]): r["count"] for r in data["series"]}
    assert by_key[("2024-06-01", "VIIRS_NOAA20_NRT")] == 2
    assert by_key[("2024-06-01", "VIIRS_SNPP_NRT")] == 1
    assert by_key[("2024-06-03", "VIIRS_NOAA20_NRT")] == 1


@pytest.mark.django_db
def test_fires_timeseries_empty(client):
    assert client.get(reverse("fires-timeseries")).json() == {
        "series": [], "min_date": None, "max_date": None,
    }


# --- fires_stats -------------------------------------------------------------

@pytest.mark.django_db
def test_fires_stats_per_tower_uses_coverage(client, tower):
    _fire("inside", -120.0, 38.05, when=_dt(2024, 7, 10))   # ~5.5 km, in range
    _fire("outside", -120.0, 38.5, when=_dt(2024, 7, 10))   # ~55 km, out of range

    data = client.get(reverse("fires-stats")).json()
    row = next(r for r in data["per_tower"] if r["id"] == tower.id)
    assert row["count"] == 1


@pytest.mark.django_db
def test_fires_stats_respects_window(client, tower):
    _fire("jul", -120.0, 38.05, when=_dt(2024, 7, 10))
    _fire("aug", -120.0, 38.05, when=_dt(2024, 8, 10))

    url = reverse("fires-stats") + "?start=2024-07-01&end=2024-07-31"
    row = next(
        r for r in client.get(url).json()["per_tower"] if r["id"] == tower.id
    )
    assert row["count"] == 1


@pytest.mark.django_db
def test_fires_stats_frp_buckets_skip_nulls(client, tower):
    _fire("low", -120.0, 38.05, when=_dt(2024, 7, 10), frp=5.0)
    _fire("mid", -120.0, 38.05, when=_dt(2024, 7, 10), frp=30.0)
    _fire("hot", -120.0, 38.05, when=_dt(2024, 7, 10), frp=600.0)
    _fire("none", -120.0, 38.05, when=_dt(2024, 7, 10), frp=None)

    by_label = {
        b["label"]: b["count"]
        for b in client.get(reverse("fires-stats")).json()["frp_buckets"]
    }
    assert by_label["0–10"] == 1
    assert by_label["10–50"] == 1
    assert by_label["500+"] == 1
    # The null-FRP detection lands in no bucket.
    assert sum(by_label.values()) == 3


# --- risk_timeseries ---------------------------------------------------------

@pytest.mark.django_db
def test_risk_timeseries_averages_across_towers(client):
    a = WatchtowerSite.objects.create(
        name="A", location=Point(-120.0, 38.0, srid=4326), elevation_m=1000
    )
    b = WatchtowerSite.objects.create(
        name="B", location=Point(-121.0, 39.0, srid=4326), elevation_m=1000
    )
    _assessment(a, date(2024, 7, 1), 20.0)
    _assessment(b, date(2024, 7, 1), 40.0)
    for tower, prob in ((a, 0.1), (b, 0.3)):
        IgnitionPrediction.objects.create(
            tower=tower, date=date(2024, 7, 1), probability=prob,
            horizon_days=3, model_version="v",
        )

    day = client.get(reverse("risk-timeseries")).json()["series"][0]
    assert day["date"] == "2024-07-01"
    assert day["mean_risk"] == pytest.approx(30.0)
    assert day["mean_ignition"] == pytest.approx(0.2)


@pytest.mark.django_db
def test_risk_timeseries_null_ignition_without_predictions(client, tower):
    _assessment(tower, date(2024, 7, 1), 25.0)
    assert client.get(reverse("risk-timeseries")).json()["series"][0][
        "mean_ignition"
    ] is None
