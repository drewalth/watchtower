"""Group tower coverage areas into spatially-tight clusters so each FIRMS
query covers a small bounding box.

NASA FIRMS caps a single area request by bbox-area × days, so one union
envelope over geographically dispersed towers (e.g. California + Colorado +
Washington + Oregon, ~19°×16° of mostly-empty terrain) would HTTP 400 and pull
fires nowhere near any tower. Clustering the towers and issuing one tight bbox
per cluster keeps every request small. Overlapping clusters are harmless — the
fire ingest dedupes on a stable ``external_uid``.

Pure geometry: no Django models, no DB. Operates on GEOS polygons in SRID 4326
(the SRID ``WatchtowerSite.coverage_area()`` returns), so it is unit-testable
with hand-built geometries.
"""

# Max gap (in degrees) between two coverage envelopes for them to land in the
# same cluster. ~1.5° keeps a state's lookouts together while keeping CA / CO /
# WA / OR — hundreds of km apart — in separate clusters.
CLUSTER_LINK_DEGREES = 1.5

# Soft cap on a cluster bbox's longest side (degrees). The working CA-only
# envelope is ~5×7°, so 8° leaves headroom. Exceeding it does NOT split the
# cluster (v1); it is surfaced to the caller so a human notices a too-big
# cluster before FIRMS 400s.
MAX_CLUSTER_SPAN_DEGREES = 8.0


_Extent = tuple[float, float, float, float]  # (west, south, east, north)


def _extent_gap(a: _Extent, b: _Extent) -> float:
    """Smallest axis gap (degrees) between two ``(west, south, east, north)`` extents.

    0 if they overlap or touch on both axes; otherwise the larger of the x-gap
    and y-gap — single-linkage proximity in bbox space (cheap, no buffering).
    """
    aw, as_, ae, an = a
    bw, bs, be, bn = b
    dx = max(bw - ae, aw - be, 0.0)
    dy = max(bs - an, as_ - bn, 0.0)
    return max(dx, dy)


def cluster_extents(
    extents: list[_Extent],
    link_degrees: float = CLUSTER_LINK_DEGREES,
) -> list[list[int]]:
    """Single-linkage connected components over a list of ``(w, s, e, n)`` extents.

    Two extents share a cluster when their gap <= ``link_degrees``, transitively.
    Returns a list of clusters, each a list of indices into ``extents``.
    Deterministic: input order drives iteration and clusters come back ordered
    by their lowest member index.
    """
    n = len(extents)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]  # path compression
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[max(ri, rj)] = min(ri, rj)

    for i in range(n):
        for j in range(i + 1, n):
            if _extent_gap(extents[i], extents[j]) <= link_degrees:
                union(i, j)

    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return [groups[root] for root in sorted(groups)]


def _merge_extents(extents: list[_Extent]) -> _Extent:
    """Bounding ``(west, south, east, north)`` of several extents."""
    return (
        min(e[0] for e in extents),
        min(e[1] for e in extents),
        max(e[2] for e in extents),
        max(e[3] for e in extents),
    )


def cluster_bboxes(
    coverage_areas: list,
    link_degrees: float = CLUSTER_LINK_DEGREES,
    max_span: float = MAX_CLUSTER_SPAN_DEGREES,
) -> tuple[list[_Extent], list[_Extent]]:
    """Cluster GEOS coverage polygons (SRID 4326) into FIRMS-sized bboxes.

    Returns ``(bboxes, oversized)`` where ``bboxes`` is a list of
    ``(west, south, east, north)`` tuples, one per cluster, and ``oversized`` is
    the sublist of those whose longest side exceeds ``max_span`` (so the caller
    can warn). Empty input → ``([], [])``.
    """
    if not coverage_areas:
        return [], []
    extents = [geom.envelope.extent for geom in coverage_areas]
    clusters = cluster_extents(extents, link_degrees)
    bboxes = [_merge_extents([extents[i] for i in members]) for members in clusters]
    oversized = [b for b in bboxes if max(b[2] - b[0], b[3] - b[1]) > max_span]
    return bboxes, oversized
