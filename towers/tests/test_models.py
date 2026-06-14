import pytest
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D

from towers.models import WatchtowerSite


@pytest.mark.django_db
def test_tower_found_by_distance_query():
    """A tower can be created and found via a spatial distance lookup."""
    tower = WatchtowerSite.objects.create(
        name="Test Lookout",
        location=Point(-121.5, 38.5, srid=4326),
        elevation_m=1500,
    )

    # A point ~roughly within 100 km should match; far away should not.
    near = WatchtowerSite.objects.filter(
        location__distance_lte=(Point(-121.6, 38.6, srid=4326), D(km=100))
    )
    far = WatchtowerSite.objects.filter(
        location__distance_lte=(Point(-100.0, 20.0, srid=4326), D(km=100))
    )

    assert tower in near
    assert tower not in far
