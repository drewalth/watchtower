from datetime import datetime, timezone

import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse

from towers.models import FireDetection, WatchtowerSite


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
