import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import {
  type Loadable,
  getNextLoadableState,
  getLoadedData,
  initialLoadable,
  isFailed,
  isLoaded,
} from "@/lib/loadable";
import {
  API,
  firesQuery,
  statsQuery,
  type FireCollection,
  type FireProps,
  type FireStats,
  type FireTimeseries,
  type RiskTimeseries,
  type TowerCollection,
  type TowerRiskDetail,
} from "@/lib/types";
import { presetWindow, type PresetKey, type TimeWindow } from "@/lib/time";

/** Initial time window: the last 30 days of available data. */
const DEFAULT_PRESET: PresetKey = "30d";

/** A fire detection the user clicked, with the coordinates for its popup. */
export type SelectedFire = { lng: number; lat: number; props: FireProps };

interface AppState {
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
  selectedFire: SelectedFire | null;

  /** Latched once the map-critical data has loaded — the data half of the
   *  reveal gate. Never flips back, so a later window refetch (fires →
   *  `reloading`) can't bounce the user back to the init screen. */
  ready: boolean;
  /** Latched once the MapLibre map has fully loaded (style + first render) —
   *  the map half of the reveal gate. Mirrors `ready`; set by a reporter inside
   *  the map provider since `useMap()` isn't reachable from AppInitializer. */
  mapReady: boolean;
}

interface AppActions {
  /** Kick off the whole load pipeline. Idempotent (runs once per app load). */
  initialize: () => void;
  /** Re-run any map-critical fetch that previously failed. */
  retry: () => void;
  /** Re-fetch all data in place (keeping the current window) after an ingest. */
  refresh: () => void;
  /** Latch `mapReady` once the MapLibre map reports fully loaded. */
  setMapReady: () => void;
  setPreset: (preset: PresetKey) => void;
  setWindow: (window: TimeWindow) => void;
  loadTowerRisk: (id: number) => void;
  selectFire: (fire: SelectedFire | null) => void;
}

export type AppStore = AppState & AppActions;

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

// Module-level so a remount never re-runs init, and so stale in-flight window
// fetches can be aborted when a newer window supersedes them.
let didInit = false;
const controllers = new Map<string, AbortController>();

export const useAppStore = create<AppStore>()(
  immer((set, get) => {
    /** Drive one Loadable field through loading → loaded | failed, aborting any
     *  prior in-flight request for the same `key` (drops stale responses, e.g.
     *  a slow earlier window). Returns the data, or null on failure/abort. */
    async function runLoad<T>(
      key: string,
      url: string,
      read: () => Loadable<T>,
      write: (next: Loadable<T>) => void,
    ): Promise<T | null> {
      controllers.get(key)?.abort();
      const ctrl = new AbortController();
      controllers.set(key, ctrl);

      write(getNextLoadableState(read()));
      try {
        const data = await fetchJson<T>(url, ctrl.signal);
        if (ctrl.signal.aborted) return null;
        write({ state: "loaded", data });
        return data;
      } catch (e) {
        if (ctrl.signal.aborted) return null;
        write({ state: "failed", error: errMsg(e), data: null });
        return null;
      }
    }

    const loadTowers = () =>
      runLoad<TowerCollection>(
        "towers",
        API.towers,
        () => get().towers,
        (n) =>
          set((s) => {
            s.towers = n;
          }),
      );

    const loadRisk = () =>
      runLoad<RiskTimeseries>(
        "risk",
        API.riskTimeseries,
        () => get().risk,
        (n) =>
          set((s) => {
            s.risk = n;
          }),
      );

    const loadFires = (window: TimeWindow) =>
      runLoad<FireCollection>(
        "fires",
        firesQuery(window),
        () => get().fires,
        (n) =>
          set((s) => {
            s.fires = n;
          }),
      );

    const loadStats = (window: TimeWindow) =>
      runLoad<FireStats>(
        "stats",
        statsQuery(window),
        () => get().stats,
        (n) =>
          set((s) => {
            s.stats = n;
          }),
      );

    /** Refresh just the timeseries Loadable in place — used by `refresh()`,
     *  which must keep the user's current window (unlike the init chain below
     *  that derives a fresh default window from it). */
    const loadTimeseries = () =>
      runLoad<FireTimeseries>(
        "timeseries",
        API.firesTimeseries,
        () => get().timeseries,
        (n) =>
          set((s) => {
            s.timeseries = n;
          }),
      );

    /** Load the timeseries, derive the default window from its date range, then
     *  fetch the window-scoped fires + stats. Collapses the old two-wave
     *  waterfall into one orchestrated chain. */
    async function loadTimeseriesThenWindow(): Promise<void> {
      const ts = await runLoad<FireTimeseries>(
        "timeseries",
        API.firesTimeseries,
        () => get().timeseries,
        (n) =>
          set((s) => {
            s.timeseries = n;
          }),
      );
      if (!ts || !ts.min_date || !ts.max_date) return;
      const window = presetWindow(DEFAULT_PRESET, ts.min_date, ts.max_date);
      set((s) => {
        s.timeWindow = window;
        s.preset = DEFAULT_PRESET;
      });
      await Promise.all([loadFires(window), loadStats(window)]);
    }

    /** Latch `ready` once all three map-critical sources have loaded. */
    const maybeMarkReady = () =>
      set((s) => {
        if (
          !s.ready &&
          isLoaded(s.towers) &&
          isLoaded(s.timeseries) &&
          isLoaded(s.fires)
        ) {
          s.ready = true;
        }
      });

    return {
      towers: initialLoadable(),
      timeseries: initialLoadable(),
      fires: initialLoadable(),
      risk: initialLoadable(),
      stats: initialLoadable(),
      towerRisk: {},
      timeWindow: null,
      preset: null,
      selectedFire: null,
      ready: false,
      mapReady: false,

      initialize: () => {
        if (didInit) return;
        didInit = true;
        void loadTowers().then(maybeMarkReady);
        void loadRisk();
        void loadTimeseriesThenWindow().then(maybeMarkReady);
      },

      retry: () => {
        const s = get();
        if (isFailed(s.towers)) void loadTowers().then(maybeMarkReady);
        if (isFailed(s.risk)) void loadRisk();
        if (isFailed(s.timeseries)) {
          void loadTimeseriesThenWindow().then(maybeMarkReady);
        } else if (s.timeWindow) {
          const window = s.timeWindow;
          if (isFailed(s.fires)) void loadFires(window).then(maybeMarkReady);
          if (isFailed(s.stats)) void loadStats(window);
        }
      },

      refresh: () => {
        // Re-fetch in place after a data ingest. Loaded fields transition to
        // `reloading` (not `loading`) and `ready` is already latched, so the map
        // updates without bouncing back to the init screen. Keep the user's
        // current window — don't re-derive a default one.
        void loadTowers();
        void loadRisk();
        void loadTimeseries();
        const window = get().timeWindow;
        if (window) {
          void loadFires(window);
          void loadStats(window);
        }
      },

      setPreset: (preset) => {
        const ts = getLoadedData(get().timeseries);
        if (!ts?.min_date || !ts?.max_date) return;
        const window = presetWindow(preset, ts.min_date, ts.max_date);
        set((s) => {
          s.preset = preset;
          s.timeWindow = window;
        });
        void loadFires(window);
        void loadStats(window);
      },

      setWindow: (window) => {
        set((s) => {
          s.preset = null; // a manual brush is no longer one of the presets
          s.timeWindow = window;
        });
        void loadFires(window);
        void loadStats(window);
      },

      loadTowerRisk: (id) => {
        const cur = get().towerRisk[id];
        if (cur && (cur.state === "loading" || cur.state === "loaded")) return;
        set((s) => {
          s.towerRisk[id] = { state: "loading", data: null };
        });
        fetchJson<TowerRiskDetail>(API.towerRisk(id))
          .then((data) =>
            set((s) => {
              s.towerRisk[id] = { state: "loaded", data };
            }),
          )
          .catch((e) =>
            set((s) => {
              s.towerRisk[id] = {
                state: "failed",
                error: errMsg(e),
                data: null,
              };
            }),
          );
      },

      selectFire: (fire) =>
        set((s) => {
          s.selectedFire = fire;
        }),

      setMapReady: () =>
        set((s) => {
          s.mapReady = true;
        }),
    };
  }),
);

/** The data half of the reveal gate: true once the map-critical data has
 *  loaded (latched). */
export const selectAppReady = (s: AppStore): boolean => s.ready;

/** The map half of the reveal gate: true once the MapLibre map is fully loaded
 *  (latched). */
export const selectMapReady = (s: AppStore): boolean => s.mapReady;
