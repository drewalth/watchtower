import pytest
from django.contrib.gis.geos import Point
from django.urls import reverse

from towers.models import WatchtowerSite


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
    # GeoJSON coordinates are [lon, lat].
    assert feature["geometry"]["coordinates"] == [-121.5, 38.5]
    assert feature["properties"]["name"] == "Diablo Peak Lookout"
    assert feature["properties"]["coverage_radius_km"] == 25.0


@pytest.mark.django_db
def test_towers_geojson_empty(client):
    """No towers is still a valid (empty) FeatureCollection, not an error."""
    response = client.get(reverse("towers-geojson"))
    assert response.status_code == 200
    data = response.json()
    assert data == {"type": "FeatureCollection", "features": []}
