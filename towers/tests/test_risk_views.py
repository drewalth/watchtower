"""Risk fields on the towers feed + the per-tower risk detail endpoint."""
from datetime import date

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse

from towers.models import (
    FireRiskAssessment,
    IgnitionPrediction,
    WatchtowerSite,
)


@pytest.fixture
def tower(db):
    return WatchtowerSite.objects.create(
        name="Risk View",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1500,
        fuel_type="conifer",
    )


def _assessment(tower, day, level, score, **overrides):
    fields = dict(
        ffmc=88.0, dmc=20.0, dc=150.0, isi=8.0, bui=25.0, fwi=15.0,
        snow_covered=False,
    )
    fields.update(overrides)
    return FireRiskAssessment.objects.create(
        tower=tower, date=day, risk_level=level, risk_score=score, **fields
    )


@pytest.mark.django_db
def test_towers_geojson_includes_latest_risk(client, tower):
    _assessment(tower, date(2026, 6, 10), "moderate", 25.0)
    _assessment(tower, date(2026, 6, 12), "high", 55.0)

    feature = client.get(reverse("towers-geojson")).json()["features"][0]
    props = feature["properties"]
    assert props["risk_level"] == "high"  # most recent
    assert props["risk_score"] == 55.0
    assert props["risk_date"] == "2026-06-12"


@pytest.mark.django_db
def test_towers_geojson_handles_no_risk_yet(client, tower):
    props = client.get(reverse("towers-geojson")).json()["features"][0]["properties"]
    assert props["risk_level"] is None
    assert props["risk_score"] is None


@pytest.mark.django_db
def test_tower_risk_detail_endpoint(client, tower):
    _assessment(tower, date(2026, 6, 10), "moderate", 25.0)
    _assessment(tower, date(2026, 6, 12), "high", 55.0, fwi=18.0)

    data = client.get(reverse("tower-risk", args=[tower.id])).json()
    assert data["tower"]["id"] == tower.id
    assert data["tower"]["name"] == "Risk View"
    assert data["tower"]["fuel_type"] == "conifer"

    # Latest-first series with the contributing FWI-system factors.
    assert len(data["series"]) == 2
    latest = data["series"][0]
    assert latest["date"] == "2026-06-12"
    assert latest["risk_level"] == "high"
    assert latest["fwi"] == 18.0
    assert "ffmc" in latest and "dmc" in latest and "dc" in latest


@pytest.mark.django_db
def test_tower_risk_detail_404_for_unknown_tower(client):
    assert client.get(reverse("tower-risk", args=[999])).status_code == 404


@pytest.mark.django_db
def test_prediction_fields_are_null_safe_before_a_model_exists(client, tower):
    _assessment(tower, date(2026, 6, 12), "high", 55.0)

    props = client.get(reverse("towers-geojson")).json()["features"][0]["properties"]
    assert props["ignition_probability"] is None
    assert props["horizon_days"] is None
    assert props["model_version"] is None

    detail = client.get(reverse("tower-risk", args=[tower.id])).json()
    assert detail["prediction"]["ignition_probability"] is None


@pytest.mark.django_db
def test_latest_prediction_surfaces_in_both_endpoints(client, tower):
    _assessment(tower, date(2026, 6, 12), "high", 55.0)
    IgnitionPrediction.objects.create(
        tower=tower, date=date(2026, 6, 12), probability=0.18,
        horizon_days=3, model_version="hgb-20260612",
    )

    props = client.get(reverse("towers-geojson")).json()["features"][0]["properties"]
    assert props["ignition_probability"] == pytest.approx(0.18)
    assert props["horizon_days"] == 3
    assert props["model_version"] == "hgb-20260612"

    pred = client.get(reverse("tower-risk", args=[tower.id])).json()["prediction"]
    assert pred["ignition_probability"] == pytest.approx(0.18)
    assert pred["model_version"] == "hgb-20260612"
