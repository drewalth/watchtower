// Pure, framework-free filter logic for the client-side map filters. Kept out
// of the store/components so it unit-tests in the node vitest env (no DOM).

import { matchSorter } from "match-sorter";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

import type { MapFilters } from "@/store/appStore";
import type { FireCollection, TowerCollection } from "@/lib/types";

type TowerFeature = TowerCollection["features"][number];
type FireFeature = FireCollection["features"][number];

/** Apply the cheap exact filters (state / has-active-fire / min fire count) in a
 *  single pass, then fuzzy-rank by name. Returns the matching tower features in
 *  relevance order (name match) or original order (no query). */
export function filterTowers(
  towers: TowerCollection,
  filters: MapFilters,
): TowerFeature[] {
  const { state, hasActiveFire, minFireCount, searchText } = filters;

  const feats = towers.features.filter((f) => {
    const p = f.properties;
    if (state && p.state !== state) return false;
    if (hasActiveFire && p.fire_count <= 0) return false;
    if (p.fire_count < minFireCount) return false;
    return true;
  });

  const q = searchText.trim();
  if (!q) return feats;
  return matchSorter(feats, q, { keys: ["properties.name"] });
}

/** [minX, minY, maxX, maxY] — a polygon's lon/lat bounding box. */
type BBox = [number, number, number, number];

/** One pass over a polygon's rings to get its bounding box. Computed once per
 *  visible tower so the per-fire test can reject far-away fires with four number
 *  comparisons instead of walking a ~250k-vertex viewshed. */
function polygonBBox(poly: GeoJSON.Polygon | GeoJSON.MultiPolygon): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rings =
    poly.type === "Polygon" ? poly.coordinates : poly.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring as [number, number][]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Fire detections that fall inside ANY visible tower's coverage polygon.
 *  Note: this runs over the currently-loaded (windowed) fires — a different,
 *  intentional scope from a tower's server-side `fire_count` (all-time).
 *
 *  Viewshed polygons are huge (hundreds of thousands of vertices), so a naive
 *  point-in-polygon per fire×tower is intractable over a full window (~100k
 *  fires). We precompute each polygon's bounding box once and reject fires
 *  outside it cheaply, only running the precise `booleanPointInPolygon` for the
 *  handful of fires actually near a visible tower. */
export function firesInVisibleCoverage(
  fires: FireCollection,
  visibleTowers: TowerFeature[],
): FireFeature[] {
  const coverage = visibleTowers
    .map((t) => t.properties.coverage)
    .filter((c): c is GeoJSON.Polygon | GeoJSON.MultiPolygon => c != null)
    .map((poly) => ({ poly, bbox: polygonBBox(poly) }));
  if (coverage.length === 0) return [];

  return fires.features.filter((fire) => {
    const coord = fire.geometry.coordinates as [number, number];
    const [x, y] = coord;
    for (const { poly, bbox } of coverage) {
      const [minX, minY, maxX, maxY] = bbox;
      if (x < minX || x > maxX || y < minY || y > maxY) continue; // cheap reject
      if (booleanPointInPolygon(coord, poly)) return true;
    }
    return false;
  });
}
