"""Phase 0 smoke test: GeoDjango's geometry types import and work.

No database access — this just confirms the GEOS bindings are wired up, which
is the Phase 0 'definition of done' check expressed as a test.
"""


def test_geos_point_constructs():
    from django.contrib.gis.geos import Point

    point = Point(-121.5, 38.5, srid=4326)

    assert point.srid == 4326
    assert (point.x, point.y) == (-121.5, 38.5)
