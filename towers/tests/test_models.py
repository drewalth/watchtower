from datetime import datetime, timezone

import pytest
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D

from towers.models import FireDetection, WatchtowerSite


@pytest.mark.django_db
def test_tower_found_by_distance_query():
    """A tower can be created and found via a spatial distance lookup."""
    tower = WatchtowerSite.objects.create(
        name="Test Lookout",
        location=Point(-121.5, 38.5, srid=4326),
        elevation_m=1500,
    )

    near = WatchtowerSite.objects.filter(
        location__distance_lte=(Point(-121.6, 38.6, srid=4326), D(km=100))
    )
    far = WatchtowerSite.objects.filter(
        location__distance_lte=(Point(-100.0, 20.0, srid=4326), D(km=100))
    )

    assert tower in near
    assert tower not in far


def _fire(uid, lon, lat):
    return FireDetection.objects.create(
        external_uid=uid,
        location=Point(lon, lat, srid=4326),
        acquired_at=datetime(2026, 6, 13, 1, 18, tzinfo=timezone.utc),
        source="VIIRS_NOAA20_NRT",
        confidence="n",
    )


@pytest.mark.django_db
def test_fires_in_range_includes_only_inside_radius():
    """fires_in_range returns exactly the detections within the radius."""
    tower = WatchtowerSite.objects.create(
        name="Range Test",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1000,
        coverage_radius_km=20.0,
    )
    # 0.1deg lat ~= 11 km (inside 20 km); 0.3deg ~= 33 km (outside).
    inside = _fire("inside", -120.0, 38.1)
    outside = _fire("outside", -120.0, 38.3)

    result = tower.fires_in_range()

    assert inside in result
    assert outside not in result
    assert result.count() == 1


@pytest.mark.django_db
def test_coverage_area_is_polygon_in_4326():
    """Coverage is a reprojected buffer: a 4326 polygon covering the radius."""
    tower = WatchtowerSite.objects.create(
        name="Coverage Test",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1000,
        coverage_radius_km=20.0,
    )

    poly = tower.coverage_area()

    assert poly.geom_type == "Polygon"
    assert poly.srid == 4326
    # A point ~11 km away is inside the 20 km coverage; ~33 km away is outside.
    assert poly.contains(Point(-120.0, 38.1, srid=4326))
    assert not poly.contains(Point(-120.0, 38.3, srid=4326))
