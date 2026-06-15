import { describe, expect, it } from "vitest";

import { filterTowers, firesInVisibleCoverage } from "./filterTowers";
import type { FireCollection, TowerCollection, TowerProps } from "./types";
import type { MapFilters } from "@/store/appStore";

const NO_FILTERS: MapFilters = {
  searchText: "",
  state: null,
  minFireCount: 0,
  hasActiveFire: false,
};

/** A unit square covering (0,0)→(1,1). */
const UNIT_SQUARE: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
};

function tower(
  props: Partial<TowerProps> & { id: number; name: string },
): TowerCollection["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: {
      state: "CA",
      elevation_m: 1000,
      coverage_radius_km: 50,
      fire_count: 0,
      coverage_kind: "circle",
      risk_level: null,
      risk_score: null,
      risk_date: null,
      coverage: null,
      ignition_probability: null,
      horizon_days: null,
      model_version: null,
      ...props,
    },
  };
}

function towerCollection(
  features: TowerCollection["features"],
): TowerCollection {
  return { type: "FeatureCollection", features };
}

const TOWERS = towerCollection([
  tower({ id: 1, name: "Sierra Buttes Lookout", state: "CA", fire_count: 3 }),
  tower({ id: 2, name: "Devils Head Lookout", state: "CO", fire_count: 0 }),
  tower({ id: 3, name: "Mount Pilchuck Lookout", state: "WA", fire_count: 5 }),
]);

describe("filterTowers", () => {
  it("returns all towers with no filters", () => {
    expect(filterTowers(TOWERS, NO_FILTERS)).toHaveLength(3);
  });

  it("filters by state", () => {
    const out = filterTowers(TOWERS, { ...NO_FILTERS, state: "CA" });
    expect(out.map((f) => f.properties.id)).toEqual([1]);
  });

  it("hasActiveFire drops towers with fire_count === 0", () => {
    const out = filterTowers(TOWERS, { ...NO_FILTERS, hasActiveFire: true });
    expect(out.map((f) => f.properties.id).sort()).toEqual([1, 3]);
  });

  it("minFireCount floors by fire_count", () => {
    const out = filterTowers(TOWERS, { ...NO_FILTERS, minFireCount: 4 });
    expect(out.map((f) => f.properties.id)).toEqual([3]);
  });

  it("fuzzy-matches by name", () => {
    const out = filterTowers(TOWERS, { ...NO_FILTERS, searchText: "sierra" });
    expect(out.map((f) => f.properties.name)).toEqual([
      "Sierra Buttes Lookout",
    ]);
  });

  it("combines exact filters with fuzzy search", () => {
    const out = filterTowers(TOWERS, {
      ...NO_FILTERS,
      state: "WA",
      searchText: "lookout",
    });
    expect(out.map((f) => f.properties.id)).toEqual([3]);
  });
});

describe("firesInVisibleCoverage", () => {
  const fires: FireCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [0.5, 0.5] }, // inside
        properties: {
          id: 1,
          source: "VIIRS",
          frp: 1,
          confidence: "n",
          brightness: 1,
          acquired_at: "2025-01-01T00:00:00Z",
        },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [5, 5] }, // outside
        properties: {
          id: 2,
          source: "VIIRS",
          frp: 1,
          confidence: "n",
          brightness: 1,
          acquired_at: "2025-01-01T00:00:00Z",
        },
      },
    ],
  };

  const covered = [tower({ id: 1, name: "T", coverage: UNIT_SQUARE })];

  it("keeps fires inside a visible tower's coverage, drops those outside", () => {
    const out = firesInVisibleCoverage(fires, covered);
    expect(out.map((f) => f.properties.id)).toEqual([1]);
  });

  it("returns [] when no towers are visible", () => {
    expect(firesInVisibleCoverage(fires, [])).toEqual([]);
  });

  it("returns [] when visible towers have no coverage polygons", () => {
    const noCoverage = [tower({ id: 9, name: "N", coverage: null })];
    expect(firesInVisibleCoverage(fires, noCoverage)).toEqual([]);
  });

  it("drops a fire inside the bbox but outside a concave polygon", () => {
    // An L-shape whose bbox is the unit square but which excludes the top-right
    // quadrant — guards the bbox prefilter against false positives.
    const lShape: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [0.5, 1],
          [0.5, 0.5],
          [1, 0.5],
          [1, 0],
          [0, 0],
        ],
      ],
    };
    const inBox: FireCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0.75, 0.75] }, // in bbox, outside L
          properties: {
            id: 7,
            source: "VIIRS",
            frp: 1,
            confidence: "n",
            brightness: 1,
            acquired_at: "2025-01-01T00:00:00Z",
          },
        },
      ],
    };
    const towers = [tower({ id: 1, name: "L", coverage: lShape })];
    expect(firesInVisibleCoverage(inBox, towers)).toEqual([]);
  });
});
