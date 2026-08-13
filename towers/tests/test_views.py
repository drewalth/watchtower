from datetime import date, datetime, timezone

import pytest
from django.contrib.gis.geos import Point
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from towers.models import (
    FireDetection,
    FireRiskAssessment,
    IgnitionPrediction,
    WatchtowerSite,
)


@pytest.mark.django_db
def test_towers_geojson_structure(client):
    """The endpoint returns a valid GeoJSON FeatureCollection."""
    WatchtowerSite.objects.create(
        name="Diablo Peak Lookout",
        location=Point(-121.5, 38.5, srid=4326),
        elevation_m=1200,
        coverage_radius_km=25.0,
    )

    response = client.get(reverse("towers-geojson"))
    assert response.status_code == 200

    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 1

    feature = data["features"][0]
    assert feature["type"] == "Feature"
    assert feature["geometry"]["type"] == "Point"
    assert feature["geometry"]["coordinates"] == [-121.5, 38.5]
    assert feature["properties"]["name"] == "Diablo Peak Lookout"
    assert feature["properties"]["coverage_radius_km"] == 25.0
    assert feature["properties"]["fire_count"] == 0
    # Coverage polygon is embedded for the map to draw.
    assert feature["properties"]["coverage"]["type"] == "Polygon"


@pytest.mark.django_db
def test_towers_geojson_empty(client):
    """No towers is still a valid (empty) FeatureCollection, not an error."""
    response = client.get(reverse("towers-geojson"))
    assert response.status_code == 200
    assert response.json() == {"type": "FeatureCollection", "features": []}


def _fire(uid, lon, lat):
    return FireDetection.objects.create(
        external_uid=uid,
        location=Point(lon, lat, srid=4326),
        acquired_at=datetime(2026, 6, 13, 1, 18, tzinfo=timezone.utc),
        source="VIIRS_NOAA20_NRT",
        confidence="n",
    )


@pytest.mark.django_db
def test_fires_geojson_returns_all(client):
    _fire("a", -120.0, 38.1)
    _fire("b", -130.0, 45.0)

    data = client.get(reverse("fires-geojson")).json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 2
    assert data["features"][0]["properties"]["source"] == "VIIRS_NOAA20_NRT"


@pytest.mark.django_db
def test_tower_fires_geojson_filters_to_range(client):
    tower = WatchtowerSite.objects.create(
        name="Range Endpoint",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1000,
        coverage_radius_km=20.0,
    )
    _fire("inside", -120.0, 38.1)   # ~11 km
    _fire("outside", -120.0, 38.3)  # ~33 km

    url = reverse("tower-fires-geojson", args=[tower.id])
    data = client.get(url).json()

    assert len(data["features"]) == 1


def _make_radius_towers(n):
    """n radius-only towers spread along a latitude so they don't overlap."""
    WatchtowerSite.objects.all().delete()
    for i in range(n):
        WatchtowerSite.objects.create(
            name=f"T{i}",
            location=Point(-120.0 - i * 0.3, 38.0, srid=4326),
            elevation_m=1000,
            coverage_radius_km=20.0,
        )


@pytest.mark.django_db
def test_towers_geojson_has_no_n_plus_one(client):
    """Query count is constant in the number of towers.

    The old implementation issued ~3 queries per tower (in-range count, latest
    risk, latest prediction); the annotated + aggregate rewrite must stay flat.
    """
    def queries_for(n):
        _make_radius_towers(n)
        with CaptureQueriesContext(connection) as ctx:
            client.get(reverse("towers-geojson"))
        return len(ctx)

    assert queries_for(2) == queries_for(10)


@pytest.mark.django_db
def test_fires_stats_has_no_n_plus_one(client):
    """Per-tower stats must not issue one spatial query per tower either."""
    def queries_for(n):
        _make_radius_towers(n)
        with CaptureQueriesContext(connection) as ctx:
            client.get(reverse("fires-stats"))
        return len(ctx)

    assert queries_for(2) == queries_for(10)


@pytest.mark.django_db
def test_towers_geojson_carries_latest_risk_and_prediction(client):
    """The annotated path surfaces the *latest* assessment + prediction, matching
    the old per-tower property lookups (correctness, not just query count)."""
    tower = WatchtowerSite.objects.create(
        name="Annotated",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1000,
        coverage_radius_km=20.0,
    )
    FireRiskAssessment.objects.create(
        tower=tower, date=date(2024, 7, 1), risk_level="high", risk_score=72.0,
        ffmc=90.0, dmc=30.0, dc=200.0, isi=10.0, bui=40.0, fwi=25.0, snow_covered=False,
    )
    FireRiskAssessment.objects.create(  # newer → this one should win
        tower=tower, date=date(2024, 7, 2), risk_level="extreme", risk_score=88.0,
        ffmc=92.0, dmc=35.0, dc=220.0, isi=12.0, bui=45.0, fwi=30.0, snow_covered=False,
    )
    IgnitionPrediction.objects.create(
        tower=tower, date=date(2024, 7, 2), probability=0.42,
        horizon_days=3, model_version="v1",
    )

    props = client.get(reverse("towers-geojson")).json()["features"][0]["properties"]
    assert props["risk_level"] == "extreme"
    assert props["risk_score"] == 88.0
    assert props["risk_date"] == "2024-07-02"
    assert props["ignition_probability"] == 0.42
    assert props["horizon_days"] == 3
    assert props["model_version"] == "v1"


@pytest.mark.django_db
def test_towers_geojson_null_risk_and_prediction_are_null(client):
    """A tower with no assessment/prediction yet serializes explicit nulls."""
    WatchtowerSite.objects.create(
        name="Bare", location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1000, coverage_radius_km=20.0,
    )
    props = client.get(reverse("towers-geojson")).json()["features"][0]["properties"]
    assert props["risk_level"] is None
    assert props["risk_score"] is None
    assert props["risk_date"] is None
    assert props["ignition_probability"] is None
    assert props["horizon_days"] is None
    assert props["model_version"] is None
