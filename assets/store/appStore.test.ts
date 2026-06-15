import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal API payloads. min/max span Jan 1 → Feb 1 so the default "30d" preset
// derives a known window (Feb 1 minus 29 days = Jan 3, clamped to min).
const towersPayload = { type: "FeatureCollection", features: [] };
const timeseriesPayload = {
  series: [],
  min_date: "2025-01-01",
  max_date: "2025-02-01",
};
const riskPayload = { series: [] };
const firesPayload = { type: "FeatureCollection", features: [] };
const statsPayload = { per_tower: [], frp_buckets: [] };

const flush = () => new Promise((r) => setTimeout(r, 0));

function routePayload(url: string): unknown {
  if (url.startsWith("/api/towers")) return towersPayload;
  if (url.startsWith("/api/fires/timeseries")) return timeseriesPayload;
  if (url.startsWith("/api/risk/timeseries")) return riskPayload;
  if (url.startsWith("/api/fires/stats")) return statsPayload;
  if (url.startsWith("/api/fires.geojson")) return firesPayload;
  throw new Error(`unexpected url ${url}`);
}

/** Fresh module instance per test — resets the module-level `didInit` guard and
 *  the store singleton so each test drives `initialize()` from scratch. */
async function freshStore() {
  vi.resetModules();
  return import("./appStore");
}

describe("appStore.initialize", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => routePayload(String(url)),
      })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("loads critical data, derives the default window, and latches ready", async () => {
    const { useAppStore, selectAppReady } = await freshStore();
    useAppStore.getState().initialize();

    for (let i = 0; i < 50 && !useAppStore.getState().ready; i++) {
      await flush();
    }

    const s = useAppStore.getState();
    expect(selectAppReady(s)).toBe(true);
    expect(s.timeWindow).toEqual({ start: "2025-01-03", end: "2025-02-01" });
    expect(s.preset).toBe("30d");
    expect(s.towers.state).toBe("loaded");
    expect(s.timeseries.state).toBe("loaded");
    expect(s.fires.state).toBe("loaded");
    // Analytics data is fetched during init too (it just doesn't gate reveal).
    expect(s.risk.state).toBe("loaded");
    expect(s.stats.state).toBe("loaded");
  });

  it("keeps the old fires on screen while a new window reloads", async () => {
    const { useAppStore } = await freshStore();
    useAppStore.getState().initialize();
    for (let i = 0; i < 50 && !useAppStore.getState().ready; i++) {
      await flush();
    }
    expect(useAppStore.getState().fires.data).toBe(firesPayload);

    // Next fires fetch never resolves — we only assert the synchronous handoff.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<never>(() => {})),
    );
    useAppStore
      .getState()
      .setWindow({ start: "2025-01-10", end: "2025-02-01" });

    const s = useAppStore.getState();
    expect(s.timeWindow).toEqual({ start: "2025-01-10", end: "2025-02-01" });
    expect(s.preset).toBeNull(); // a manual window clears the preset
    expect(s.fires.state).toBe("reloading");
    expect(s.fires.data).toBe(firesPayload); // previous data stays visible
  });
});

describe("appStore filters", () => {
  it("updates each filter field and resets to defaults", async () => {
    const { useAppStore } = await freshStore();
    const store = useAppStore.getState();

    store.setSearchText("sierra");
    store.setStateFilter("CA");
    store.setMinFireCount(3);
    store.setHasActiveFire(true);

    expect(useAppStore.getState().filters).toEqual({
      searchText: "sierra",
      state: "CA",
      minFireCount: 3,
      hasActiveFire: true,
    });

    useAppStore.getState().resetFilters();
    expect(useAppStore.getState().filters).toEqual({
      searchText: "",
      state: null,
      minFireCount: 0,
      hasActiveFire: false,
    });
  });

  it("toggles the reloading-overlay flag", async () => {
    const { useAppStore } = await freshStore();
    expect(useAppStore.getState().isFiltering).toBe(false);
    useAppStore.getState().setIsFiltering(true);
    expect(useAppStore.getState().isFiltering).toBe(true);
  });
});
