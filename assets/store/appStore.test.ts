import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { presetWindow } from "@/lib/time";

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
const towerRiskPayload = {
  tower: { id: 42, name: "Test Tower", fuel_type: "C-3" },
  prediction: {
    ignition_probability: null,
    horizon_days: null,
    model_version: null,
  },
  series: [],
};

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Flush repeatedly until the predicate is true (max 50 iterations). */
async function flushUntil(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !pred(); i++) await flush();
}

function routePayload(url: string): unknown {
  // Tower risk route must come BEFORE the /api/towers catch-all.
  if (/^\/api\/towers\/\d+\/risk\.json/.test(url)) return towerRiskPayload;
  if (url.startsWith("/api/towers")) return towersPayload;
  if (url.startsWith("/api/fires/timeseries")) return timeseriesPayload;
  if (url.startsWith("/api/risk/timeseries")) return riskPayload;
  if (url.startsWith("/api/fires/stats")) return statsPayload;
  if (url.startsWith("/api/fires.geojson")) return firesPayload;
  throw new Error(`unexpected url ${url}`);
}

/** A fetch stub that resolves every request with routePayload. */
function makeFetch() {
  return vi.fn(async (url: string) => ({
    ok: true,
    json: async () => routePayload(String(url)),
  }));
}

/** A fetch stub that never resolves (drives hangs / in-flight states). */
const neverFetch = () => vi.fn(() => new Promise<never>(() => {}));

/** A fetch stub that rejects all requests with a 500 error. */
function rejectingFetch() {
  return vi.fn(async (_url: string) => ({
    ok: false as const,
    status: 500,
    statusText: "Internal Server Error",
    json: async () => ({}),
  }));
}

/**
 * A fetch stub where individual URL prefixes can be overridden to reject or
 * hang; a URL not matched by any override falls through to routePayload.
 * `swap(urlPrefix, handler)` lets you change a URL's behavior mid-test.
 */
function perUrlFetch(
  initial: Record<
    string,
    "reject" | "hang" | ((url: string) => Promise<unknown>)
  > = {},
) {
  const overrides = new Map<
    string,
    "reject" | "hang" | ((url: string) => Promise<unknown>)
  >(Object.entries(initial));

  const fn = vi.fn(async (url: string) => {
    const key = [...overrides.keys()].find((prefix) => url.startsWith(prefix));
    const override = key !== undefined ? overrides.get(key) : undefined;
    if (override === "reject") {
      return {
        ok: false as const,
        status: 500,
        statusText: "Server Error",
        json: async () => ({}),
      };
    }
    if (override === "hang") {
      return new Promise<never>(() => {});
    }
    if (typeof override === "function") {
      return override(url);
    }
    return { ok: true, json: async () => routePayload(url) };
  });

  const swap = (
    urlPrefix: string,
    handler: "reject" | "hang" | ((url: string) => Promise<unknown>) | "ok",
  ) => {
    if (handler === "ok") {
      overrides.delete(urlPrefix);
    } else {
      overrides.set(urlPrefix, handler);
    }
  };

  return { fn, swap };
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

// ─────────────────────────────────────────────────────────────────────────────
// Characterization tests — lock CURRENT store behavior as a refactor safety net
// ─────────────────────────────────────────────────────────────────────────────

describe("appStore.initialize — idempotency (didInit guard)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is idempotent: towers are fetched exactly once on a double initialize()", async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { useAppStore } = await freshStore();
    useAppStore.getState().initialize();
    useAppStore.getState().initialize(); // second call must be a no-op

    await flushUntil(() => useAppStore.getState().ready);

    // Count how many times the towers URL was fetched.
    const towersCalls = fetchMock.mock.calls.filter(([url]: [string]) =>
      String(url).startsWith("/api/towers.geojson"),
    );
    expect(towersCalls).toHaveLength(1);
  });
});

describe("appStore.retry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("re-runs only previously-failed critical fetches (good sources not refetched)", async () => {
    // Phase 1: towers rejects, everything else succeeds.
    const { fn: fetchMock, swap } = perUrlFetch({
      "/api/towers": "reject",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useAppStore } = await freshStore();
    useAppStore.getState().initialize();
    await flushUntil(() => useAppStore.getState().towers.state === "failed");

    expect(useAppStore.getState().towers.state).toBe("failed");
    expect(useAppStore.getState().ready).toBe(false);

    // Phase 2: towers now resolves.
    swap("/api/towers", "ok");
    const callsBeforeRetry = fetchMock.mock.calls.length;

    // Count timeseries calls before retry — should not increase.
    const timeseriesCallsBefore = fetchMock.mock.calls.filter(
      ([url]: [string]) => String(url).startsWith("/api/fires/timeseries"),
    ).length;

    useAppStore.getState().retry();
    await flushUntil(() => useAppStore.getState().ready);

    expect(useAppStore.getState().towers.state).toBe("loaded");
    expect(useAppStore.getState().ready).toBe(true);

    // Timeseries was already loaded — retry must not refetch it.
    const timeseriesCallsAfter = fetchMock.mock.calls.filter(
      ([url]: [string]) => String(url).startsWith("/api/fires/timeseries"),
    ).length;
    expect(timeseriesCallsAfter).toBe(timeseriesCallsBefore);

    // At least one new call was made (the towers retry), but not a full re-init.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  it("retry of failed timeseries re-derives the time window", async () => {
    // Timeseries rejects first.
    const { fn: fetchMock, swap } = perUrlFetch({
      "/api/fires/timeseries": "reject",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useAppStore } = await freshStore();
    useAppStore.getState().initialize();
    await flushUntil(
      () => useAppStore.getState().timeseries.state === "failed",
    );

    expect(useAppStore.getState().timeseries.state).toBe("failed");
    expect(useAppStore.getState().timeWindow).toBeNull();

    // Timeseries now resolves.
    swap("/api/fires/timeseries", "ok");
    useAppStore.getState().retry();
    await flushUntil(() => useAppStore.getState().ready);

    const s = useAppStore.getState();
    expect(s.timeseries.state).toBe("loaded");
    // Window was derived from the timeseries payload.
    expect(s.timeWindow).toEqual(
      presetWindow("30d", "2025-01-01", "2025-02-01"),
    );
    expect(s.fires.state).toBe("loaded");
    expect(s.stats.state).toBe("loaded");
  });

  it("retry of failed fires keeps the existing time window", async () => {
    // Fires rejects; everything else succeeds.
    const { fn: fetchMock, swap } = perUrlFetch({
      "/api/fires.geojson": "reject",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useAppStore } = await freshStore();
    useAppStore.getState().initialize();
    // Wait for timeseries to load (window will be derived) then fires to fail.
    await flushUntil(() => useAppStore.getState().fires.state === "failed");

    const windowBeforeRetry = useAppStore.getState().timeWindow;
    expect(windowBeforeRetry).not.toBeNull();

    // Fires now resolves.
    swap("/api/fires.geojson", "ok");
    useAppStore.getState().retry();
    await flushUntil(() => useAppStore.getState().fires.state === "loaded");

    // Window must not change — retry reuses the existing one.
    expect(useAppStore.getState().timeWindow).toEqual(windowBeforeRetry);
    expect(useAppStore.getState().fires.state).toBe("loaded");
  });
});

describe("appStore.refresh", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps current window, transitions loaded→reloading, retains prior fires.data", async () => {
    // Full init with normal fetch.
    vi.stubGlobal("fetch", makeFetch());
    const { useAppStore } = await freshStore();
    useAppStore.getState().initialize();
    await flushUntil(() => useAppStore.getState().ready);

    const window = { start: "2025-01-10", end: "2025-02-01" };
    useAppStore.getState().setWindow(window);
    await flush(); // let setWindow's fires/stats fetches resolve

    // Switch to neverFetch so refresh's re-fetches hang in-flight.
    vi.stubGlobal("fetch", neverFetch());

    useAppStore.getState().refresh();

    const s = useAppStore.getState();
    // Window is unchanged.
    expect(s.timeWindow).toEqual(window);
    // Preset was cleared by setWindow; refresh does not restore it.
    expect(s.preset).toBeNull();
    // Fires transitions to reloading with prior data retained.
    expect(s.fires.state).toBe("reloading");
    expect(s.fires.data).toBe(firesPayload);
  });
});

describe("appStore.setPreset", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("derives a new window via presetWindow and refetches fires+stats", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const { useAppStore } = await freshStore();
    useAppStore.getState().initialize();
    await flushUntil(() => useAppStore.getState().ready);

    useAppStore.getState().setPreset("7d");
    await flushUntil(() => useAppStore.getState().fires.state === "loaded");

    const s = useAppStore.getState();
    expect(s.preset).toBe("7d");
    expect(s.timeWindow).toEqual(
      presetWindow("7d", "2025-01-01", "2025-02-01"),
    );
    expect(s.fires.state).toBe("loaded");
    expect(s.stats.state).toBe("loaded");
  });

  it("is a no-op when timeseries is not yet loaded", async () => {
    // Use neverFetch so timeseries never arrives.
    const fetchMock = neverFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { useAppStore } = await freshStore();
    // Do NOT initialize — timeseries stays in "initial" state.
    const callsBefore = fetchMock.mock.calls.length;

    useAppStore.getState().setPreset("7d");
    await flush();

    // No fetches should have been triggered.
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    // State unchanged.
    expect(useAppStore.getState().timeWindow).toBeNull();
    expect(useAppStore.getState().preset).toBeNull();
  });
});

describe("appStore.loadTowerRisk", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("transitions loading→loaded with the tower risk payload", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const { useAppStore } = await freshStore();

    useAppStore.getState().loadTowerRisk(42);

    // Synchronously: the entry should be in "loading" state.
    expect(useAppStore.getState().towerRisk[42]?.state).toBe("loading");

    await flush();

    const entry = useAppStore.getState().towerRisk[42];
    expect(entry?.state).toBe("loaded");
    if (entry?.state === "loaded") {
      expect(entry.data).toEqual(towerRiskPayload);
    }
  });

  it("dedupes concurrent calls (fetches the URL exactly once)", async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { useAppStore } = await freshStore();

    // Call twice while still in-flight.
    useAppStore.getState().loadTowerRisk(42);
    useAppStore.getState().loadTowerRisk(42); // should be deduplicated

    await flush();

    // Call again after loaded — also deduplicated.
    useAppStore.getState().loadTowerRisk(42);

    await flush();

    const riskCalls = fetchMock.mock.calls.filter(([url]: [string]) =>
      String(url).includes("/api/towers/42/risk.json"),
    );
    expect(riskCalls).toHaveLength(1);
  });

  it("transitions to failed with an error string on a 500 response", async () => {
    const { fn: fetchMock, swap } = perUrlFetch({
      "/api/towers/42/risk.json": "reject",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useAppStore } = await freshStore();
    useAppStore.getState().loadTowerRisk(42);
    await flush();

    const entry = useAppStore.getState().towerRisk[42];
    expect(entry?.state).toBe("failed");
    if (entry?.state === "failed") {
      expect(typeof entry.error).toBe("string");
      expect(entry.error.length).toBeGreaterThan(0);
    }

    // Suppress unused-variable warning from swap being unused.
    void swap;
  });
});

describe("appStore UI state", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("selectFire sets and clears the selected fire", async () => {
    const { useAppStore } = await freshStore();
    const fire = {
      lng: -120.5,
      lat: 37.2,
      props: {
        id: 1,
        source: "VIIRS",
        frp: 10,
        confidence: "h",
        brightness: 310,
        acquired_at: "2025-01-15T00:00:00Z",
      },
    };

    expect(useAppStore.getState().selectedFire).toBeNull();

    useAppStore.getState().selectFire(fire);
    expect(useAppStore.getState().selectedFire).toEqual(fire);

    useAppStore.getState().selectFire(null);
    expect(useAppStore.getState().selectedFire).toBeNull();
  });

  it("setViewport records the camera viewport", async () => {
    const { useAppStore } = await freshStore();
    const viewport = {
      center: [-120.5, 37.2] as [number, number],
      zoom: 10,
      bearing: 0,
      pitch: 0,
    };

    expect(useAppStore.getState().viewport).toBeNull();

    useAppStore.getState().setViewport(viewport);
    expect(useAppStore.getState().viewport).toEqual(viewport);
  });

  it("setMapReady latches mapReady to true and selectMapReady reflects it", async () => {
    const { useAppStore, selectMapReady } = await freshStore();

    expect(useAppStore.getState().mapReady).toBe(false);
    expect(selectMapReady(useAppStore.getState())).toBe(false);

    useAppStore.getState().setMapReady();
    expect(useAppStore.getState().mapReady).toBe(true);
    expect(selectMapReady(useAppStore.getState())).toBe(true);

    // Calling it again is safe (idempotent latch).
    useAppStore.getState().setMapReady();
    expect(useAppStore.getState().mapReady).toBe(true);
  });
});

describe("appStore.ready gate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stays false until towers AND timeseries AND fires are all loaded", async () => {
    // Fires hang indefinitely.
    const { fn: fetchMock } = perUrlFetch({
      "/api/fires.geojson": "hang",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { useAppStore } = await freshStore();
    useAppStore.getState().initialize();

    // Let towers + timeseries load.
    await flushUntil(
      () =>
        useAppStore.getState().towers.state === "loaded" &&
        useAppStore.getState().timeseries.state === "loaded",
    );

    // fires is still loading/hanging → ready must remain false.
    expect(useAppStore.getState().fires.state).toBe("loading");
    expect(useAppStore.getState().ready).toBe(false);
  });

  it("does not un-latch ready when fires enters reloading state", async () => {
    // Full init first.
    vi.stubGlobal("fetch", makeFetch());
    const { useAppStore } = await freshStore();
    useAppStore.getState().initialize();
    await flushUntil(() => useAppStore.getState().ready);
    expect(useAppStore.getState().ready).toBe(true);

    // Switch to neverFetch so the window re-fetch hangs.
    vi.stubGlobal("fetch", neverFetch());
    useAppStore
      .getState()
      .setWindow({ start: "2025-01-10", end: "2025-02-01" });

    // fires is now reloading — but ready must stay true (one-way latch).
    expect(useAppStore.getState().fires.state).toBe("reloading");
    expect(useAppStore.getState().ready).toBe(true);
  });
});

describe("appStore.setWindow — stale-window abort", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops an older in-flight fires response when a newer window supersedes it", async () => {
    // Full init so the store is ready.
    vi.stubGlobal("fetch", makeFetch());
    const { useAppStore } = await freshStore();
    useAppStore.getState().initialize();
    await flushUntil(() => useAppStore.getState().ready);

    // Two deferred resolvers for /api/fires.geojson (A and B).
    const firesPayloadA = {
      type: "FeatureCollection",
      features: [{ id: "A" }],
    };
    const firesPayloadB = {
      type: "FeatureCollection",
      features: [{ id: "B" }],
    };

    let resolveA!: (v: unknown) => void;
    let resolveB!: (v: unknown) => void;
    const deferA = new Promise<unknown>((r) => (resolveA = r));
    const deferB = new Promise<unknown>((r) => (resolveB = r));

    let firesFetchCount = 0;
    const controlledFetch = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/fires.geojson")) {
        firesFetchCount++;
        const payload = firesFetchCount === 1 ? deferA : deferB;
        const data = await payload;
        return { ok: true, json: async () => data };
      }
      return { ok: true, json: async () => routePayload(String(url)) };
    });
    vi.stubGlobal("fetch", controlledFetch);

    const W1 = { start: "2025-01-05", end: "2025-01-25" };
    const W2 = { start: "2025-01-10", end: "2025-02-01" };

    // Issue W1 then immediately W2 — W2 aborts the W1 fires request.
    useAppStore.getState().setWindow(W1);
    useAppStore.getState().setWindow(W2);

    // Resolve B (W2's response) first, then A (W1's stale response).
    resolveB(firesPayloadB);
    await flush();
    resolveA(firesPayloadA);
    await flush();

    const s = useAppStore.getState();
    // The store keeps W2's window.
    expect(s.timeWindow).toEqual(W2);
    // The store holds B's data (the newer window's response).
    expect(s.fires.state).toBe("loaded");
    expect(s.fires.data).toEqual(firesPayloadB);
  });
});
