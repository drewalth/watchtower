from datetime import datetime, timezone

import pytest
from django.contrib.gis.geos import MultiPolygon, Point, Polygon

from towers.models import FireDetection, WatchtowerSite
from towers.viewshed import _tile_name, _utm_srid


def test_tile_name_matches_copernicus_convention():
    # SW corner (33N, 117W) -> the tile covering Boucher Hill (~33.35, -116.90).
    assert _tile_name(33, -117) == "Copernicus_DSM_COG_10_N33_00_W117_00_DEM"
    # Southern / eastern hemisphere corners flip the N/S and E/W letters.
    assert _tile_name(-34, 18) == "Copernicus_DSM_COG_10_S34_00_E018_00_DEM"


def test_utm_srid_for_california():
    assert _utm_srid(-120.6, 39.6) == 32610  # UTM 10N
    assert _utm_srid(-116.9, 33.3) == 32611  # UTM 11N


def _fire(uid, lon, lat):
    return FireDetection.objects.create(
        external_uid=uid,
        location=Point(lon, lat, srid=4326),
        acquired_at=datetime(2026, 6, 13, 1, 18, tzinfo=timezone.utc),
        source="VIIRS_NOAA20_NRT",
        confidence="n",
    )


@pytest.mark.django_db
def test_fires_in_range_uses_viewshed_when_present():
    """With a viewshed set, only fires inside that polygon count — not the circle."""
    tower = WatchtowerSite.objects.create(
        name="Viewshed Tower",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1000,
        coverage_radius_km=50.0,
    )
    # A small visible patch offset from the tower (not the full radius circle).
    patch = Polygon(
        ((-120.05, 38.05), (-120.03, 38.05), (-120.03, 38.07), (-120.05, 38.07), (-120.05, 38.05)),
        srid=4326,
    )
    tower.viewshed = MultiPolygon(patch, srid=4326)
    tower.save(update_fields=["viewshed"])

    visible = _fire("visible", -120.04, 38.06)  # inside the viewshed patch
    blocked = _fire("blocked", -120.0, 38.0)  # in the circle, behind terrain

    result = tower.fires_in_range()

    assert tower.coverage_kind == "viewshed"
    assert visible in result
    assert blocked not in result
    assert result.count() == 1
