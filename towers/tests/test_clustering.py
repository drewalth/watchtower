"""Pure unit tests for the FIRMS bbox clustering — no DB needed.

GEOS geometries only require ``django.contrib.gis.geos`` (libgeos), not a
database connection, so these tests run without ``@pytest.mark.django_db``.
"""
from django.contrib.gis.geos import Point

from towers.clustering import (
    MAX_CLUSTER_SPAN_DEGREES,
    _extent_gap,
    cluster_bboxes,
    cluster_extents,
)


def _square(lon, lat, half=0.2):
    """A small square polygon (SRID 4326) centred on (lon, lat)."""
    return Point(lon, lat, srid=4326).buffer(half).envelope


def test_two_distant_groups_split():
    # A California-ish cluster and a Colorado-ish cluster, hundreds of km apart.
    areas = [_square(-120.0, 38.0), _square(-120.1, 38.1), _square(-106.0, 39.0)]
    bboxes, _ = cluster_bboxes(areas)
    assert len(bboxes) == 2


def test_nearby_towers_merge():
    areas = [_square(-120.0, 38.0), _square(-120.1, 38.05)]
    bboxes, _ = cluster_bboxes(areas)
    assert len(bboxes) == 1
    west, south, east, north = bboxes[0]
    # The single bbox must contain both tower centres.
    assert west <= -120.1 <= east and west <= -120.0 <= east
    assert south <= 38.0 <= north and south <= 38.05 <= north


def test_single_tower_one_cluster():
    area = _square(-120.0, 38.0)
    bboxes, oversized = cluster_bboxes([area])
    assert len(bboxes) == 1
    assert oversized == []
    assert bboxes[0] == area.envelope.extent


def test_empty_input():
    assert cluster_bboxes([]) == ([], [])


def test_oversized_cluster_flagged():
    # One polygon far wider than the span cap.
    wide = _square(-120.0, 38.0, half=MAX_CLUSTER_SPAN_DEGREES)
    bboxes, oversized = cluster_bboxes([wide])
    assert len(bboxes) == 1
    assert oversized == bboxes


def test_transitive_chain_merges():
    # A links B, B links C, but A and C are too far to link directly. Single
    # linkage must still merge all three.
    areas = [_square(-120.0, 38.0), _square(-119.0, 38.0), _square(-118.0, 38.0)]
    bboxes, _ = cluster_bboxes(areas, link_degrees=1.5)
    assert len(bboxes) == 1


def test_cluster_order_deterministic():
    areas = [_square(-120.0, 38.0), _square(-106.0, 39.0), _square(-120.1, 38.1)]
    first, _ = cluster_bboxes(areas)
    second, _ = cluster_bboxes(areas)
    assert first == second


def test_cluster_extents_groups_by_index():
    # Two near extents (0, 2) and one far (1) → groups ordered by lowest index.
    extents = [(-120.5, 37.8, -119.5, 38.2),
               (-106.5, 38.8, -105.5, 39.2),
               (-120.4, 37.9, -119.4, 38.3)]
    groups = cluster_extents(extents)
    assert groups == [[0, 2], [1]]


def test_extent_gap_overlap_is_zero():
    a = (-120.0, 38.0, -119.0, 39.0)
    b = (-119.5, 38.5, -118.5, 39.5)  # overlaps a
    assert _extent_gap(a, b) == 0.0


def test_extent_gap_x_only():
    a = (-120.0, 38.0, -119.0, 39.0)
    b = (-118.0, 38.0, -117.0, 39.0)  # 1° gap on x, aligned on y
    assert _extent_gap(a, b) == 1.0


def test_extent_gap_y_only():
    a = (-120.0, 38.0, -119.0, 39.0)
    b = (-120.0, 41.0, -119.0, 42.0)  # 2° gap on y, aligned on x
    assert _extent_gap(a, b) == 2.0


def test_extent_gap_diagonal_takes_max_axis():
    a = (-120.0, 38.0, -119.0, 39.0)
    b = (-117.0, 42.0, -116.0, 43.0)  # 2° on x, 3° on y → max is 3
    assert _extent_gap(a, b) == 3.0
