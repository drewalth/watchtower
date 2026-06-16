import type { StateCreator } from "zustand";

import type { MapViewport } from "@/components/ui/map";
import type { Loadable } from "@/lib/loadable";
import type {
  FireCollection,
  FireProps,
  FireStats,
  FireTimeseries,
  RiskTimeseries,
  TowerCollection,
  TowerRiskDetail,
} from "@/lib/types";
import type { PresetKey, TimeWindow } from "@/lib/time";

// ─── Shared value types ───────────────────────────────────────────────────────

/** A fire detection the user clicked, with the coordinates for its popup. */
export type SelectedFire = { lng: number; lat: number; props: FireProps };

/** Client-side map filters. All applied in-memory to already-loaded data — no
 *  refetch. `searchText` holds the committed (debounced) value; the input
 *  component owns the raw keystrokes. */
export interface MapFilters {
  searchText: string;
  state: string | null; // null = all states
  minFireCount: number; // 0 = no floor
  hasActiveFire: boolean; // true = only towers with fire_count > 0
}

export const DEFAULT_FILTERS: MapFilters = {
  searchText: "",
  state: null,
  minFireCount: 0,
  hasActiveFire: false,
};

/** Initial time window: the last 30 days of available data. */
export const DEFAULT_PRESET: PresetKey = "30d";

// ─── Slice interfaces ─────────────────────────────────────────────────────────

export interface DataSlice {
  /** Map-critical data (gates the initialization screen). */
  towers: Loadable<TowerCollection>;
  timeseries: Loadable<FireTimeseries>;
  fires: Loadable<FireCollection>;
  /** Analytics data (loads in the background; never gates reveal). */
  risk: Loadable<RiskTimeseries>;
  stats: Loadable<FireStats>;
  /** Lazy per-tower risk detail, fetched when a tower popup opens. */
  towerRisk: Record<number, Loadable<TowerRiskDetail>>;

  /** UI state lifted out of MapView. */
  timeWindow: TimeWindow | null;
  preset: PresetKey | null;

  /** Latched once the map-critical data has loaded — the data half of the
   *  reveal gate. Never flips back, so a later window refetch (fires →
   *  `reloading`) can't bounce the user back to the init screen. */
  ready: boolean;

  /** Kick off the whole load pipeline. Idempotent (runs once per app load). */
  initialize: () => void;
  /** Re-run any map-critical fetch that previously failed. */
  retry: () => void;
  /** Re-fetch all data in place (keeping the current window) after an ingest. */
  refresh: () => void;
  setPreset: (preset: PresetKey) => void;
  setWindow: (window: TimeWindow) => void;
  loadTowerRisk: (id: number) => void;
}

export interface FiltersSlice {
  /** Client-side filters applied to the loaded towers + fires. */
  filters: MapFilters;
  /** Transient: true while the debounced text search is settling — drives the
   *  full-screen reloading overlay only. Set by FilterSearchControl off the
   *  debounce edge; not derived from any Loadable. */
  isFiltering: boolean;

  setSearchText: (text: string) => void;
  setStateFilter: (state: string | null) => void;
  setMinFireCount: (n: number) => void;
  setHasActiveFire: (on: boolean) => void;
  resetFilters: () => void;
  setIsFiltering: (on: boolean) => void;
}

export interface UiSlice {
  selectedFire: SelectedFire | null;
  /** Last known map camera (center/zoom/bearing/pitch). Updated on gesture end
   *  and re-applied across basemap switches so changing the style doesn't snap
   *  the view back to the new style's default. Persisted imperatively (no
   *  selector subscribes to it) so pan/zoom never re-renders the map subtree. */
  viewport: MapViewport | null;
  /** Latched once the MapLibre map has fully loaded (style + first render) —
   *  the map half of the reveal gate. Mirrors `ready`; set by a reporter inside
   *  the map provider since `useMap()` isn't reachable from AppInitializer. */
  mapReady: boolean;

  selectFire: (fire: SelectedFire | null) => void;
  /** Record the current map camera (called on gesture end / style restore). */
  setViewport: (viewport: MapViewport) => void;
  /** Latch `mapReady` once the MapLibre map reports fully loaded. */
  setMapReady: () => void;
}

/** The full combined store type. */
export type AppStore = DataSlice & FiltersSlice & UiSlice;

// ─── Slice creator alias ──────────────────────────────────────────────────────

/** Immer-flavored StateCreator bound to the full AppStore. Use this for all
 *  three slices so `set((s) => { s.x = y })` mutation syntax type-checks with
 *  no casts. */
export type AppStateCreator<TSlice> = StateCreator<
  AppStore,
  [["zustand/immer", never]],
  [],
  TSlice
>;
