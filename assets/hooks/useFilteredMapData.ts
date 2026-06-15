import { useDeferredValue, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { getLoadedData } from "@/lib/loadable";
import { filterTowers, firesInVisibleCoverage } from "@/lib/filterTowers";
import type { FireCollection, TowerCollection } from "@/lib/types";
import { useAppStore } from "@/store/appStore";

interface FilteredTowers {
  /** Towers matching the active filters (null until towers have loaded). */
  visibleTowerCollection: TowerCollection | null;
  /** The same features as an array, for the (cheap) fire-coverage test. */
  visibleTowers: TowerCollection["features"];
  /** How many towers match — for the "N of M towers" readout. */
  visibleCount: number;
  /** Total loaded towers, for the same readout. */
  totalCount: number;
  /** True when any filter actually narrows the set (drives the fire fast-path). */
  filtersActive: boolean;
}

/** Cheap tower filtering — runs the exact filters + fuzzy name match over the
 *  ~27 towers. Safe to call from several components (TowerMarkers, CoverageLayer,
 *  FilterSearchControl); the work is trivial. The fuzzy-search value is deferred
 *  so typing stays responsive. Deliberately does NOT compute the fire coverage
 *  set — that pass is expensive and lives in `useVisibleFireCollection`. */
export function useFilteredTowers(): FilteredTowers {
  const towers = useAppStore((s) => getLoadedData(s.towers));
  const filters = useAppStore(useShallow((s) => s.filters));

  const deferredSearch = useDeferredValue(filters.searchText);

  const visibleTowers = useMemo(
    () =>
      towers
        ? filterTowers(towers, { ...filters, searchText: deferredSearch })
        : [],
    // Primitive deps only (not the `filters` object) so unrelated renders skip.
    [
      towers,
      filters.state,
      filters.minFireCount,
      filters.hasActiveFire,
      deferredSearch,
    ],
  );

  const visibleTowerCollection = useMemo<TowerCollection | null>(
    () =>
      towers ? { type: "FeatureCollection", features: visibleTowers } : null,
    [towers, visibleTowers],
  );

  const filtersActive =
    filters.state !== null ||
    filters.minFireCount > 0 ||
    filters.hasActiveFire ||
    deferredSearch.trim() !== "";

  return {
    visibleTowerCollection,
    visibleTowers,
    visibleCount: visibleTowers.length,
    totalCount: towers?.features.length ?? 0,
    filtersActive,
  };
}

/** Fires the map should show. With no active filter we show every loaded fire
 *  (the original behaviour) and skip the point-in-polygon pass entirely — vital,
 *  since a full window is ~100k fires against ~250k-vertex viewsheds. Only when a
 *  filter narrows the towers do we restrict fires to the visible coverage.
 *
 *  Call this from exactly one component (FireClusterLayer): it owns the only
 *  copy of the heavy computation. Returns null until fires have loaded. */
export function useVisibleFireCollection(): FireCollection | null {
  const fires = useAppStore((s) => getLoadedData(s.fires));
  const { visibleTowers, filtersActive } = useFilteredTowers();

  return useMemo<FireCollection | null>(() => {
    if (!fires) return null;
    if (!filtersActive) return fires; // fast path: no filter → all fires, no turf
    return {
      type: "FeatureCollection",
      features: firesInVisibleCoverage(fires, visibleTowers),
    };
  }, [fires, visibleTowers, filtersActive]);
}
