# Analytics Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose the wildfire watchtower map UI into a dark-first "command center" analytics dashboard — a CSS-grid shell with a TopBar, a live KPI strip, a collapsible tabbed analytics dock, and a brushable bottom timeline — reusing the existing map, store, and chart logic.

**Architecture:** A new `DashboardShell` (CSS grid: header / KPI / body / timeline) becomes the top-level component rendered by `AppInitializer`. `MapView` is slimmed to the map canvas + map-native overlays; the analytics panel and time control relocate into shell regions. Headline KPIs are computed by a pure, tested `kpis.ts` from data already in the Zustand store. A new identity layer in `globals.css` (ember accent, glass surface, risk ramp) gives the dark-first look.

**Tech Stack:** React 19 + TypeScript, Tailwind v4 (oklch tokens, class dark mode), shadcn/mapcn primitives + radix-ui, recharts v3, lucide-react, Zustand, Vite, Vitest + Testing Library.

---

## Conventions for every task

- **Dev loop:** `npm run dev` (host, Vite :5173) + Docker Django on :8000 → open <http://localhost:8000>.
- **Build check:** `npm run build` must succeed (tsc + Vite).
- **Tests:** `npx vitest run <path>` for a file; `npx vitest run` for all. Pure-logic tests use the Node env; component tests use Testing Library + jsdom (match existing `*.test.tsx`).
- **Imports:** `@/` → `assets/`. `cn` from `@/lib/utils`. Types from `@/lib/types`.
- **Wrap, don't inline:** new UI lives in its own component under `assets/components/dashboard/`; vendored primitives stay in `assets/components/ui/`.
- **Commit** after each task with the message shown.
- Branch is already `ui-polish-exp-01`.

---

## Ground-truth APIs (confirmed against source — authoritative)

These override any tentative snippet below if they conflict:

- **Loaded data:** `getLoadedData(loadable): T | null` from `@/lib/loadable`. Use it everywhere to extract data from a `Loadable` (do NOT read `.data`).
- **Store hook:** `useAppStore` from `@/store/appStore`. Loadable fields: `towers`, `timeseries`, `fires`, `risk`, `stats`. Plain fields/actions: `timeWindow`, `preset`, `setWindow(window)`, `setPreset(key)`, `isFiltering` (FiltersSlice). UI slice: `selectedFire`, `selectFire(fire)`, `viewport`, `mapReady`.
- **MapView selection pattern (replicate):**
  ```ts
  const { timeseries, risk, stats, timeWindow, preset, setWindow, setPreset } = useAppStore(
    useShallow((s) => ({
      timeseries: getLoadedData(s.timeseries), risk: getLoadedData(s.risk),
      stats: getLoadedData(s.stats), timeWindow: s.timeWindow, preset: s.preset,
      setWindow: s.setWindow, setPreset: s.setPreset,
    })),
  );
  ```
- **Window slicing:** `inWindow(rows, start, end)` (THREE args) from `@/components/analytics/shared`. E.g. `inWindow(ts.series, window.start, window.end)`, `inWindow(risk?.series ?? [], window.start, window.end)`.
- **Card props (do not change the cards):** `FiresOverTimeCard({ windowRows: FireTimeseriesDay[] })`, `SourceBreakdownCard({ windowRows: FireTimeseriesDay[] })`, `FrpDistributionCard({ stats: FireStats | null })`, `RiskTrendCard({ riskRows: RiskTimeseriesDay[] })`.
- **time.ts:** `denseDailyTotals(series, minDate, maxDate)`; `PRESETS: { key: PresetKey; label: string; days: number|null }[]`; `PresetKey = "24h"|"7d"|"30d"|"season"|"all"`.
- **Map context:** `useMap()` returns `{ map: maplibregl.Map | null, isLoaded: boolean }` — destructure `const { map } = useMap()`.
- **mapStyle:** `riskColor(level: RiskLevel | null): string`, `RISK_LABELS`, `RISK_LEVELS`, `RISK_COLORS`, `RISK_UNKNOWN` from `@/lib/mapStyle`.
- **HelpModal:** controlled — `HelpModal({ open, onOpenChange })`.
- **Reloading flag:** `useAppStore((s) => s.isFiltering)`.
- **Ingestion:** `useIngestionStatus()` returns **`void`** (side-effect: toasts). For the freshness pill, refactor it to ALSO return the latest run, OR add a sibling hook/poll. Endpoint `/api/ingestion/status.json` → `{ run: { id, status: "running"|"completed"|"failed", started_at, finished_at|null } | null }`.
- **TimeRangeControl props:** `{ dense, window, preset, onWindowChange, onPresetChange }` — preset-button row + brush BarChart.
- **Tests:** vitest env is `node` globally; component tests MUST start with `// @vitest-environment jsdom` (see `LocationControl.test.tsx`). `toBeTruthy()`/`toHaveBeenCalledWith()` work without jest-dom.

## File structure (created / modified)

**New — `assets/components/dashboard/`:**
`GlassPanel.tsx`, `kpis.ts` (+ `kpis.test.ts`), `useKpis.ts`, `leaderboard.ts` (+ `leaderboard.test.ts`), `StatTile.tsx`, `RiskDistributionBar.tsx`, `KpiStrip.tsx`, `DashboardShell.tsx`, `TopBar.tsx`, `Brand.tsx`, `FreshnessPill.tsx`, `PresetBar.tsx`, `TopProgressBar.tsx`, `AnalyticsDock.tsx`, `OverviewTab.tsx`, `TowersTab.tsx`, `RiskTab.tsx`, `TowerLeaderboard.tsx` (+ `TowerLeaderboard.test.tsx`), `TimelineDock.tsx`.

**New — `assets/components/ui/`:** `tabs.tsx`, `popover.tsx`, `badge.tsx`, `tooltip.tsx`, `scroll-area.tsx`, `separator.tsx` (vendored via shadcn CLI).

**Modified:** `assets/styles/globals.css`, `assets/components/AppInitializer.tsx`, `assets/components/map/MapView.tsx`, `assets/components/map/MapLegend.tsx`, `assets/components/map/ReloadingOverlay.tsx` (→ removed/replaced by `TopProgressBar`), `assets/components/map/TowerMarkers.tsx` (popup glass + focus), `assets/components/map/SelectedFirePopup.tsx` (glass), `assets/components/map/FilterSearchControl.tsx` (split search/filters), `assets/components/analytics/TimeRangeControl.tsx` (presets removed; brush extracted), `assets/store/slices/uiSlice.ts` (+ focus state), `assets/store/slices/types.ts` (focus types), `assets/components/InitScreen.tsx` (restyle).

**Reused unchanged:** `assets/components/analytics/FiresOverTimeCard.tsx`, `SourceBreakdownCard.tsx`, `FrpDistributionCard.tsx`, `RiskTrendCard.tsx`, `AnalyticsCard.tsx`, `shared.ts`; all map layers; `lib/time.ts`, `lib/loadable.ts`, `lib/mapStyle.ts`, `store/slices/dataSlice.ts`.

---

## Task 1: Visual identity tokens + GlassPanel

**Files:**
- Modify: `assets/styles/globals.css`
- Create: `assets/components/dashboard/GlassPanel.tsx`

- [ ] **Step 1: Add identity tokens to `globals.css`.** After the existing `:root` and `.dark` blocks (do not remove existing tokens), add a new layer. Append these custom properties inside the existing `:root` and `.dark` selectors (extend them), then add the `@theme inline` mappings.

In `:root` (light) add:
```css
  --ember: oklch(0.72 0.18 55);          /* amber-orange #f59e0b-ish */
  --ember-foreground: oklch(0.2 0.02 60);
  --brand: oklch(0.62 0.21 35);          /* fire-red #ef6548-ish */
  --surface: oklch(1 0 0 / 70%);         /* glass fill (light) */
  --surface-border: oklch(0.2 0 0 / 8%);
  --risk-low: oklch(0.74 0.16 150);
  --risk-moderate: oklch(0.83 0.16 95);
  --risk-high: oklch(0.78 0.17 65);
  --risk-very-high: oklch(0.65 0.2 40);
  --risk-extreme: oklch(0.55 0.22 28);
  --risk-unknown: oklch(0.6 0.01 250);
```
In `.dark` add (override the surface for dark + brighten ember):
```css
  --ember: oklch(0.78 0.17 65);
  --ember-foreground: oklch(0.18 0.02 60);
  --brand: oklch(0.68 0.2 38);
  --surface: oklch(0.18 0.01 250 / 72%);
  --surface-border: oklch(1 0 0 / 10%);
  --risk-low: oklch(0.78 0.17 150);
  --risk-moderate: oklch(0.86 0.17 95);
  --risk-high: oklch(0.82 0.18 65);
  --risk-very-high: oklch(0.7 0.21 40);
  --risk-extreme: oklch(0.62 0.23 28);
  --risk-unknown: oklch(0.62 0.01 250);
```
In the `@theme inline` block add the utility mappings so Tailwind exposes them:
```css
  --color-ember: var(--ember);
  --color-ember-foreground: var(--ember-foreground);
  --color-brand: var(--brand);
  --color-surface: var(--surface);
  --color-surface-border: var(--surface-border);
  --color-risk-low: var(--risk-low);
  --color-risk-moderate: var(--risk-moderate);
  --color-risk-high: var(--risk-high);
  --color-risk-very-high: var(--risk-very-high);
  --color-risk-extreme: var(--risk-extreme);
  --color-risk-unknown: var(--risk-unknown);
```

- [ ] **Step 2: Create `GlassPanel.tsx`.**
```tsx
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/** Translucent, blurred surface used for all dashboard chrome. */
export function GlassPanel({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "rounded-xl border border-surface-border bg-surface shadow-lg backdrop-blur-md",
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 3: Verify build.** Run `npm run build`. Expected: success, no TS or CSS errors.

- [ ] **Step 4: Commit.**
```bash
git add assets/styles/globals.css assets/components/dashboard/GlassPanel.tsx
git commit -m "feat(ui): wildfire-ops identity tokens + GlassPanel surface"
```

---

## Task 2: Vendor shadcn primitives

**Files:** Create `assets/components/ui/{tabs,popover,badge,tooltip,scroll-area,separator}.tsx`

- [ ] **Step 1: Add primitives via the shadcn CLI** (project already has `components.json` with the right aliases):
```bash
npx shadcn@latest add tabs popover badge tooltip scroll-area separator --yes
```
Expected: six files written to `assets/components/ui/`.

- [ ] **Step 2: Verify imports.** Open each new file; confirm it imports `cn` from `@/lib/utils` and (where applicable) from `radix-ui`. If the CLI emitted `@radix-ui/react-*` imports instead of the project's `radix-ui` meta-package, leave them — `radix-ui` re-exports, but if build fails, change imports to `import { Tabs as TabsPrimitive } from "radix-ui"` style to match existing `ui/` files (compare against `assets/components/ui/dropdown-menu.tsx`).

- [ ] **Step 3: Verify build.** Run `npm run build`. Expected: success. Fix any import mismatches per Step 2.

- [ ] **Step 4: Commit.**
```bash
git add assets/components/ui
git commit -m "feat(ui): vendor tabs, popover, badge, tooltip, scroll-area, separator"
```

---

## Task 3: KPI computation module (pure, TDD)

**Files:**
- Create: `assets/components/dashboard/kpis.ts`
- Test: `assets/components/dashboard/kpis.test.ts`

Shared types this module defines (used by Tasks 5, 6, 8):
```ts
export interface RiskDistribution {
  low: number; moderate: number; high: number;
  very_high: number; extreme: number; unknown: number;
}
export interface Kpis {
  activeFires: number;
  activeFiresSparkline: number[];   // up to last 14 daily totals in window
  towersInRange: number;
  towersTotal: number;
  elevatedRisk: number;             // high + very_high + extreme
  riskDistribution: RiskDistribution;
  peakFrpMw: number | null;
  meanIgnitionPct: number | null;   // 0..100, rounded
}
```

- [ ] **Step 1: Write the failing test** (`kpis.test.ts`):
```ts
import { describe, expect, it } from "vitest";
import { computeKpis } from "./kpis";
import type {
  FireCollection, FireStats, FireTimeseries, RiskTimeseries, TowerCollection,
} from "@/lib/types";

const towers = {
  type: "FeatureCollection",
  features: [
    tower(1, "high"), tower(2, "extreme"), tower(3, "low"),
    tower(4, null), tower(5, "very_high"),
  ],
} as unknown as TowerCollection;

function tower(id: number, risk: string | null) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-120, 39] },
    properties: { id, name: `T${id}`, risk_level: risk },
  };
}

const fires = {
  type: "FeatureCollection",
  features: [fire(12), fire(null), fire(305), fire(40)],
} as unknown as FireCollection;

function fire(frp: number | null) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [-120, 39] }, properties: { frp } };
}

const timeseries = {
  series: [
    { date: "2026-06-13", source: "A", count: 2 },
    { date: "2026-06-14", source: "A", count: 5 },
    { date: "2026-06-15", source: "B", count: 1 },
  ],
  min_date: "2026-06-13", max_date: "2026-06-15",
} as FireTimeseries;

const stats = {
  per_tower: [
    { id: 1, name: "T1", count: 7 }, { id: 2, name: "T2", count: 0 }, { id: 3, name: "T3", count: 3 },
  ],
  frp_buckets: [],
} as FireStats;

const risk = {
  series: [
    { date: "2026-06-13", mean_risk: 40, mean_ignition: 0.1 },
    { date: "2026-06-14", mean_risk: 55, mean_ignition: 0.23 },
    { date: "2026-06-15", mean_risk: 60, mean_ignition: null },
  ],
} as RiskTimeseries;

const window = { start: "2026-06-13", end: "2026-06-15" };

describe("computeKpis", () => {
  it("counts active fires from the (window-scoped) fires collection", () => {
    const k = computeKpis({ towers, fires, stats, risk, timeseries, window });
    expect(k.activeFires).toBe(4);
  });
  it("counts towers with in-range fires over total towers", () => {
    const k = computeKpis({ towers, fires, stats, risk, timeseries, window });
    expect(k.towersInRange).toBe(2);   // ids 1 and 3 have count > 0
    expect(k.towersTotal).toBe(5);
  });
  it("buckets risk levels and counts elevated (high+very_high+extreme)", () => {
    const k = computeKpis({ towers, fires, stats, risk, timeseries, window });
    expect(k.riskDistribution).toEqual({
      low: 1, moderate: 0, high: 1, very_high: 1, extreme: 1, unknown: 1,
    });
    expect(k.elevatedRisk).toBe(3);
  });
  it("takes peak FRP ignoring nulls", () => {
    const k = computeKpis({ towers, fires, stats, risk, timeseries, window });
    expect(k.peakFrpMw).toBe(305);
  });
  it("uses the latest non-null mean ignition in window as a percent", () => {
    const k = computeKpis({ towers, fires, stats, risk, timeseries, window });
    expect(k.meanIgnitionPct).toBe(23);  // 2026-06-15 is null → falls back to 06-14
  });
  it("is null-safe when everything is empty", () => {
    const k = computeKpis({ towers: null, fires: null, stats: null, risk: null, timeseries: null, window: null });
    expect(k.activeFires).toBe(0);
    expect(k.peakFrpMw).toBeNull();
    expect(k.meanIgnitionPct).toBeNull();
    expect(k.towersTotal).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails.** Run `npx vitest run assets/components/dashboard/kpis.test.ts`. Expected: FAIL ("computeKpis is not defined" / module not found).

- [ ] **Step 3: Implement `kpis.ts`:**
```ts
import { denseDailyTotals } from "@/lib/time";
import type {
  FireCollection, FireStats, FireTimeseries, RiskTimeseries,
  TimeWindow, TowerCollection,
} from "@/lib/types";

export interface RiskDistribution {
  low: number; moderate: number; high: number;
  very_high: number; extreme: number; unknown: number;
}
export interface Kpis {
  activeFires: number;
  activeFiresSparkline: number[];
  towersInRange: number;
  towersTotal: number;
  elevatedRisk: number;
  riskDistribution: RiskDistribution;
  peakFrpMw: number | null;
  meanIgnitionPct: number | null;
}

interface KpiInputs {
  towers: TowerCollection | null;
  fires: FireCollection | null;
  stats: FireStats | null;
  risk: RiskTimeseries | null;
  timeseries: FireTimeseries | null;
  window: TimeWindow | null;
}

const ELEVATED = new Set(["high", "very_high", "extreme"]);

export function computeKpis(input: KpiInputs): Kpis {
  const { towers, fires, stats, risk, timeseries, window } = input;

  const activeFires = fires?.features.length ?? 0;

  const dist: RiskDistribution = {
    low: 0, moderate: 0, high: 0, very_high: 0, extreme: 0, unknown: 0,
  };
  for (const f of towers?.features ?? []) {
    const level = f.properties.risk_level;
    if (level && level in dist) dist[level as keyof RiskDistribution]++;
    else dist.unknown++;
  }
  const elevatedRisk = dist.high + dist.very_high + dist.extreme;

  const towersInRange = (stats?.per_tower ?? []).filter((t) => t.count > 0).length;
  const towersTotal = towers?.features.length ?? 0;

  let peakFrpMw: number | null = null;
  for (const f of fires?.features ?? []) {
    const frp = f.properties.frp;
    if (frp != null && (peakFrpMw == null || frp > peakFrpMw)) peakFrpMw = frp;
  }

  let meanIgnitionPct: number | null = null;
  const series = risk?.series ?? [];
  const inWin = window
    ? series.filter((d) => d.date >= window.start && d.date <= window.end)
    : series;
  for (let i = inWin.length - 1; i >= 0; i--) {
    if (inWin[i].mean_ignition != null) {
      meanIgnitionPct = Math.round(inWin[i].mean_ignition! * 100);
      break;
    }
  }

  let activeFiresSparkline: number[] = [];
  if (timeseries && window) {
    const dense = denseDailyTotals(timeseries.series, window.start, window.end);
    activeFiresSparkline = dense.map((d) => d.count).slice(-14);
  }

  return {
    activeFires, activeFiresSparkline, towersInRange, towersTotal,
    elevatedRisk, riskDistribution: dist, peakFrpMw, meanIgnitionPct,
  };
}
```
> Note: if `denseDailyTotals`'s real signature differs, adapt the call — its job here is "one count per day across [start,end]". Confirm by reading `assets/lib/time.ts`.

- [ ] **Step 4: Run test, verify pass.** Run `npx vitest run assets/components/dashboard/kpis.test.ts`. Expected: PASS (6 tests). Adjust the sparkline assertion only if `denseDailyTotals` shape requires it.

- [ ] **Step 5: Commit.**
```bash
git add assets/components/dashboard/kpis.ts assets/components/dashboard/kpis.test.ts
git commit -m "feat(dashboard): pure KPI computation module + tests"
```

---

## Task 4: Tower leaderboard helper (pure, TDD)

**Files:**
- Create: `assets/components/dashboard/leaderboard.ts`
- Test: `assets/components/dashboard/leaderboard.test.ts`

- [ ] **Step 1: Write the failing test:**
```ts
import { describe, expect, it } from "vitest";
import { buildLeaderboard, sortLeaderboard } from "./leaderboard";
import type { FireStats, TowerCollection } from "@/lib/types";

const towers = {
  type: "FeatureCollection",
  features: [
    t(1, "Alpha", "CA", "low", 20, 0.1, 1),
    t(2, "Bravo", "OR", "extreme", 90, 0.8, 0),
    t(3, "Cedar", "CA", null, null, null, 4),
  ],
} as unknown as TowerCollection;

function t(id: number, name: string, state: string, lvl: string | null,
           score: number | null, ign: number | null, fc: number) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [-120, 39] },
    properties: { id, name, state, risk_level: lvl, risk_score: score,
      ignition_probability: ign, fire_count: fc } };
}

const stats = { per_tower: [{ id: 1, name: "Alpha", count: 9 }, { id: 2, name: "Bravo", count: 2 }],
  frp_buckets: [] } as FireStats;

describe("buildLeaderboard", () => {
  it("merges window fire counts from stats, falling back to props.fire_count", () => {
    const rows = buildLeaderboard(towers, stats);
    expect(rows.find((r) => r.id === 1)!.fireCount).toBe(9);  // from stats
    expect(rows.find((r) => r.id === 3)!.fireCount).toBe(4);  // fallback to props
  });
});

describe("sortLeaderboard", () => {
  const rows = buildLeaderboard(towers, stats);
  it("sorts by fires desc", () => {
    expect(sortLeaderboard(rows, "fires").map((r) => r.id)).toEqual([1, 3, 2]);
  });
  it("sorts by risk score desc, nulls last", () => {
    expect(sortLeaderboard(rows, "risk").map((r) => r.id)).toEqual([2, 1, 3]);
  });
  it("sorts by ignition desc, nulls last", () => {
    expect(sortLeaderboard(rows, "ignition").map((r) => r.id)).toEqual([2, 1, 3]);
  });
  it("sorts by name asc", () => {
    expect(sortLeaderboard(rows, "name").map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails.** `npx vitest run assets/components/dashboard/leaderboard.test.ts` → FAIL.

- [ ] **Step 3: Implement `leaderboard.ts`:**
```ts
import type { FireStats, RiskLevel, TowerCollection } from "@/lib/types";

export interface LeaderboardRow {
  id: number;
  name: string;
  state: string;
  riskLevel: RiskLevel | null;
  riskScore: number | null;
  ignitionProbability: number | null;
  fireCount: number;
}
export type LeaderboardSort = "fires" | "risk" | "ignition" | "name";

export function buildLeaderboard(
  towers: TowerCollection | null,
  stats: FireStats | null,
): LeaderboardRow[] {
  const byId = new Map<number, number>();
  for (const t of stats?.per_tower ?? []) byId.set(t.id, t.count);
  return (towers?.features ?? []).map((f) => {
    const p = f.properties;
    return {
      id: p.id,
      name: p.name,
      state: p.state ?? "",
      riskLevel: (p.risk_level ?? null) as RiskLevel | null,
      riskScore: p.risk_score ?? null,
      ignitionProbability: p.ignition_probability ?? null,
      fireCount: byId.get(p.id) ?? p.fire_count ?? 0,
    };
  });
}

const nullsLast = (a: number | null, b: number | null) =>
  (b ?? -Infinity) - (a ?? -Infinity);

export function sortLeaderboard(
  rows: LeaderboardRow[],
  sort: LeaderboardSort,
): LeaderboardRow[] {
  const copy = [...rows];
  switch (sort) {
    case "fires": copy.sort((a, b) => b.fireCount - a.fireCount); break;
    case "risk": copy.sort((a, b) => nullsLast(a.riskScore, b.riskScore)); break;
    case "ignition": copy.sort((a, b) => nullsLast(a.ignitionProbability, b.ignitionProbability)); break;
    case "name": copy.sort((a, b) => a.name.localeCompare(b.name)); break;
  }
  return copy;
}
```
> Confirm `RiskLevel` is exported from `@/lib/types`; if the prop names differ, align to the actual `TowerProps`.

- [ ] **Step 4: Run test, verify pass.** `npx vitest run assets/components/dashboard/leaderboard.test.ts` → PASS (5 tests).

- [ ] **Step 5: Commit.**
```bash
git add assets/components/dashboard/leaderboard.ts assets/components/dashboard/leaderboard.test.ts
git commit -m "feat(dashboard): tower leaderboard build/sort helpers + tests"
```

---

## Task 5: UI slice — tower focus state

**Files:**
- Modify: `assets/store/slices/uiSlice.ts`
- Modify: `assets/store/slices/types.ts`

- [ ] **Step 1: Read both files** to learn the slice's immer pattern and the `UiSlice`/`AppStore` interface names.

- [ ] **Step 2: Add to the UI slice interface** (`types.ts`): a field and two actions, matching existing style:
```ts
  focusedTowerId: number | null;
  focusTower: (id: number) => void;
  clearFocusedTower: () => void;
```

- [ ] **Step 3: Implement in `uiSlice.ts`** following the existing immer `set` pattern (mirror how `selectedFire` is written):
```ts
  focusedTowerId: null,
  focusTower: (id) => set((s) => { s.focusedTowerId = id; }),
  clearFocusedTower: () => set((s) => { s.focusedTowerId = null; }),
```

- [ ] **Step 4: Verify build.** `npm run build` → success.

- [ ] **Step 5: Commit.**
```bash
git add assets/store/slices/uiSlice.ts assets/store/slices/types.ts
git commit -m "feat(store): focusedTowerId + focusTower for leaderboard fly-to"
```

---

## Task 6: StatTile + RiskDistributionBar + sparkline

**Files:**
- Create: `assets/components/dashboard/RiskDistributionBar.tsx`
- Create: `assets/components/dashboard/StatTile.tsx`

- [ ] **Step 1: Create `RiskDistributionBar.tsx`:**
```tsx
import type { RiskDistribution } from "./kpis";
import { cn } from "@/lib/utils";

const SEGMENTS: { key: keyof RiskDistribution; color: string; label: string }[] = [
  { key: "low", color: "bg-risk-low", label: "Low" },
  { key: "moderate", color: "bg-risk-moderate", label: "Moderate" },
  { key: "high", color: "bg-risk-high", label: "High" },
  { key: "very_high", color: "bg-risk-very-high", label: "Very high" },
  { key: "extreme", color: "bg-risk-extreme", label: "Extreme" },
  { key: "unknown", color: "bg-risk-unknown", label: "Unknown" },
];

export function RiskDistributionBar({
  distribution, className,
}: { distribution: RiskDistribution; className?: string }) {
  const total = SEGMENTS.reduce((n, s) => n + distribution[s.key], 0) || 1;
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {SEGMENTS.map((s) => {
        const v = distribution[s.key];
        if (!v) return null;
        return (
          <div key={s.key} className={s.color}
            style={{ width: `${(v / total) * 100}%` }}
            title={`${s.label}: ${v}`} />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `StatTile.tsx`** (a tiny inline SVG sparkline; no new deps):
```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GlassPanel } from "./GlassPanel";

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const step = 100 / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${30 - (v / max) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-full text-ember">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2}
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function StatTile({
  label, value, unit, sublabel, sparkline, children, loading,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sublabel?: string;
  sparkline?: number[];
  children?: ReactNode;   // e.g. RiskDistributionBar
  loading?: boolean;
}) {
  return (
    <GlassPanel className="flex min-w-[9rem] flex-1 flex-col gap-1 px-3.5 py-2.5">
      <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {loading ? (
        <div className="h-7 w-16 animate-pulse rounded bg-muted" />
      ) : (
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold tabular-nums leading-none">{value}</span>
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </div>
      )}
      {sublabel && <span className="text-[0.7rem] text-muted-foreground">{sublabel}</span>}
      {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} />}
      {children}
    </GlassPanel>
  );
}
```

- [ ] **Step 3: Verify build.** `npm run build` → success.

- [ ] **Step 4: Commit.**
```bash
git add assets/components/dashboard/StatTile.tsx assets/components/dashboard/RiskDistributionBar.tsx
git commit -m "feat(dashboard): StatTile + RiskDistributionBar + sparkline"
```

---

## Task 7: useKpis hook + KpiStrip (with component test)

**Files:**
- Create: `assets/components/dashboard/useKpis.ts`
- Create: `assets/components/dashboard/KpiStrip.tsx`
- Test: `assets/components/dashboard/KpiStrip.test.tsx`

- [ ] **Step 1: Create `useKpis.ts`.** Read `assets/components/map/MapView.tsx` first to copy its exact store-selection pattern (how it pulls *loaded data* for `towers`/`fires`/`timeseries`/`risk`/`stats`/`timeWindow`). Mirror it here:
```ts
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";   // confirm export name
import { computeKpis, type Kpis } from "./kpis";

export function useKpis(): Kpis {
  // Replace these selectors with MapView's exact loaded-data accessors.
  const { towers, fires, timeseries, risk, stats, window } = useAppStore(
    useShallow((s) => ({
      towers: s.towers, fires: s.fires, timeseries: s.timeseries,
      risk: s.risk, stats: s.stats, window: s.timeWindow,
    })),
  );
  return useMemo(
    () => computeKpis({
      towers: loaded(towers), fires: loaded(fires), timeseries: loaded(timeseries),
      risk: loaded(risk), stats: loaded(stats), window,
    }),
    [towers, fires, timeseries, risk, stats, window],
  );
}

// Use the project's real loaded-data extractor from "@/lib/loadable"
// (getLoadedData / extractLoadableData). Replace `loaded` accordingly.
function loaded<T>(l: { data: T | null } | null): T | null {
  return l?.data ?? null;
}
```
> The `loaded()` shim works because every `Loadable` exposes `.data`; prefer the real helper if it normalizes states.

- [ ] **Step 2: Create `KpiStrip.tsx`:**
```tsx
import { useKpis } from "./useKpis";
import { StatTile } from "./StatTile";
import { RiskDistributionBar } from "./RiskDistributionBar";

const dash = (v: number | null) => (v == null ? "—" : v);

export function KpiStrip() {
  const k = useKpis();
  return (
    <div className="flex gap-2 overflow-x-auto px-3 py-2">
      <StatTile label="Active fires" value={k.activeFires}
        sparkline={k.activeFiresSparkline} sublabel="in selected window" />
      <StatTile label="Towers in range" value={k.towersInRange}
        unit={`/ ${k.towersTotal}`} sublabel="with detections" />
      <StatTile label="Elevated risk" value={k.elevatedRisk} sublabel="high+ towers">
        <RiskDistributionBar distribution={k.riskDistribution} className="mt-1.5" />
      </StatTile>
      <StatTile label="Peak FRP" value={dash(k.peakFrpMw)} unit="MW" sublabel="max intensity" />
      <StatTile label="Mean ML ignition" value={dash(k.meanIgnitionPct)}
        unit={k.meanIgnitionPct == null ? undefined : "%"} sublabel="latest model" />
    </div>
  );
}
```

- [ ] **Step 3: Write component test** (`KpiStrip.test.tsx`) — mock the hook to avoid store wiring:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./useKpis", () => ({
  useKpis: () => ({
    activeFires: 142, activeFiresSparkline: [1, 3, 2, 5, 7],
    towersInRange: 9, towersTotal: 27, elevatedRisk: 4,
    riskDistribution: { low: 10, moderate: 5, high: 2, very_high: 1, extreme: 1, unknown: 8 },
    peakFrpMw: 312, meanIgnitionPct: 23,
  }),
}));

import { KpiStrip } from "./KpiStrip";

describe("KpiStrip", () => {
  it("renders all five headline metrics", () => {
    render(<KpiStrip />);
    expect(screen.getByText("142")).toBeTruthy();
    expect(screen.getByText("/ 27")).toBeTruthy();
    expect(screen.getByText("312")).toBeTruthy();
    expect(screen.getByText("Active fires")).toBeTruthy();
  });
});
```
> If the repo's vitest config doesn't auto-load jsdom for `.test.tsx`, add `// @vitest-environment jsdom` as the first line (match an existing component test such as `LocationControl.test.tsx`).

- [ ] **Step 4: Run tests.** `npx vitest run assets/components/dashboard/KpiStrip.test.tsx` → PASS. Then `npm run build` → success.

- [ ] **Step 5: Commit.**
```bash
git add assets/components/dashboard/useKpis.ts assets/components/dashboard/KpiStrip.tsx assets/components/dashboard/KpiStrip.test.tsx
git commit -m "feat(dashboard): useKpis hook + KPI strip + test"
```

---

## Task 8: DashboardShell grid + AppInitializer wiring + slim MapView

This is the structural pivot. Goal: the shell renders header/KPI/body/timeline; MapView becomes just the map.

**Files:**
- Create: `assets/components/dashboard/DashboardShell.tsx`
- Create: `assets/components/dashboard/TopProgressBar.tsx`
- Modify: `assets/components/AppInitializer.tsx`
- Modify: `assets/components/map/MapView.tsx`

- [ ] **Step 1: Read** `AppInitializer.tsx` and `MapView.tsx` fully. Note: which store values MapView selects and passes to `AnalyticsPanel`/`TimeRangeControl`, the `dense` derivation, and the `<Map>` element + all map children.

- [ ] **Step 2: Create `TopProgressBar.tsx`** (replaces full-screen reloading blur):
```tsx
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";

export function TopProgressBar() {
  // Use the same flag ReloadingOverlay used (e.g. s.isFiltering or a reloading selector).
  const active = useAppStore((s) => s.isFiltering);
  return (
    <div className={cn(
      "pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity",
      active ? "opacity-100" : "opacity-0",
    )}>
      <div className="h-full w-1/3 animate-[loading_1s_ease-in-out_infinite] bg-ember" />
    </div>
  );
}
```
Add the keyframe to `globals.css`:
```css
@keyframes loading { 0% { transform: translateX(-100%);} 100% { transform: translateX(400%);} }
```

- [ ] **Step 3: Create `DashboardShell.tsx`.** It owns the analytics/timeline data selection that MapView used to own (move that logic here). Skeleton:
```tsx
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { MapView } from "@/components/map/MapView";
import { TopBar } from "./TopBar";
import { KpiStrip } from "./KpiStrip";
import { AnalyticsDock } from "./AnalyticsDock";
import { TimelineDock } from "./TimelineDock";
import { TopProgressBar } from "./TopProgressBar";

export function DashboardShell() {
  return (
    <div className="grid h-screen w-screen grid-rows-[auto_auto_1fr_auto] overflow-hidden bg-background text-foreground">
      <TopProgressBar />
      <TopBar />
      <KpiStrip />
      <div className="relative flex min-h-0 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          <MapView />
        </div>
        <AnalyticsDock />
      </div>
      <TimelineDock />
    </div>
  );
}
```
> The map must fill its flex cell: ensure the `<Map>` inside MapView is `h-full w-full` and its wrapper is `absolute inset-0` or `h-full`. Verify panning/zoom and that `MapViewportSync` still restores the camera.

- [ ] **Step 4: Slim `MapView.tsx`.** Remove `<AnalyticsPanel>` and `<TimeRangeControl>` and their data props/derivations (they now live in the shell / docks). Keep: `<Map>`, all layers (`CoverageLayer`, `TowerMarkers`, `FireClusterLayer`), `MapReadyReporter`, `MapViewportSync`, `MapControls`, `MapLegend` (becomes popover in Task 11), `FilterSearchControl` (search only after Task 11), `SelectedFirePopup`, `ThemeToggle` is **removed** from here (moves to TopBar in Task 10). Export `MapView` as a named export if not already. Delete the now-unused `ReloadingOverlay` usage; remove the component file if nothing else imports it.

- [ ] **Step 5: Rewire `AppInitializer.tsx`.** Replace the `<MapView />` render with `<DashboardShell />` (keep the `<InitOverlay>` reveal gate exactly as-is — it overlays the shell). Confirm the gate still reads `dataReady`/`mapReady`.

- [ ] **Step 6: Manual verify.** `npm run dev` + Django. Expect: header bar, KPI strip with live numbers, map filling the center, an (empty for now) dock placeholder on the right, timeline at the bottom. Map interactions work. `npm run build` → success.

- [ ] **Step 7: Commit.**
```bash
git add assets/components/dashboard/DashboardShell.tsx assets/components/dashboard/TopProgressBar.tsx assets/components/AppInitializer.tsx assets/components/map/MapView.tsx assets/styles/globals.css
git commit -m "feat(dashboard): command-center grid shell; slim MapView to canvas"
```
> Until Tasks 9–11 land, `TopBar`, `AnalyticsDock`, and `TimelineDock` must exist as minimal stubs so the build passes. Create one-line stub components returning `null` or a placeholder if you implement Task 8 before 9–11, and replace them in order.

---

## Task 9: TopBar (brand, presets, freshness, theme, help)

**Files:**
- Create: `assets/components/dashboard/Brand.tsx`, `PresetBar.tsx`, `FreshnessPill.tsx`, `TopBar.tsx`
- Reuse: `assets/components/map/ThemeToggle.tsx`, `assets/components/HelpModal.tsx`, `assets/hooks/useIngestionStatus.ts`, `assets/lib/time.ts` (`PRESETS`)

- [ ] **Step 1: Create `Brand.tsx`:**
```tsx
import { Flame } from "lucide-react";

export function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-md bg-brand/15 text-brand">
        <Flame className="size-4" />
      </span>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">WATCHTOWER</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-muted-foreground">
          wildfire lookout intel
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `PresetBar.tsx`** — read how the current `TimeRangeControl` calls `setPreset`/reads `preset`; reuse `PRESETS` from `@/lib/time`:
```tsx
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { PRESETS } from "@/lib/time";
import { cn } from "@/lib/utils";

export function PresetBar() {
  const { preset, setPreset } = useAppStore(
    useShallow((s) => ({ preset: s.preset, setPreset: s.setPreset })),
  );
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-surface-border bg-muted/40 p-0.5">
      {PRESETS.map((p) => (
        <button key={p.key} onClick={() => setPreset(p.key)}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors",
            preset === p.key
              ? "bg-ember text-ember-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `FreshnessPill.tsx`** — wrap `useIngestionStatus`. Read the hook's return shape first; render a dot + relative time:
```tsx
import { useIngestionStatus } from "@/hooks/useIngestionStatus";
import { cn } from "@/lib/utils";

export function FreshnessPill() {
  const status = useIngestionStatus();   // adapt to actual return
  const running = status?.run?.status === "running";
  const finished = status?.run?.finished_at ?? status?.run?.started_at ?? null;
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-surface-border bg-muted/40 px-2.5 py-1 text-xs">
      <span className={cn("size-1.5 rounded-full",
        running ? "animate-pulse bg-ember" : "bg-risk-low")} />
      <span className="text-muted-foreground">
        {running ? "refreshing…" : finished ? `updated ${relative(finished)}` : "—"}
      </span>
    </div>
  );
}

function relative(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
```

- [ ] **Step 4: Create `TopBar.tsx`** — assemble; lift the Help modal open-state here. Reuse the existing `ThemeToggle` and `HelpModal`:
```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { GlassPanel } from "./GlassPanel";
import { Brand } from "./Brand";
import { PresetBar } from "./PresetBar";
import { FreshnessPill } from "./FreshnessPill";
import { ThemeToggle } from "@/components/map/ThemeToggle";
import { HelpModal } from "@/components/HelpModal";   // adapt props if it's controlled

export function TopBar() {
  const [help, setHelp] = useState(false);
  return (
    <header className="z-20 border-b border-surface-border">
      <GlassPanel className="flex h-12 items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-3">
        <Brand />
        <div className="flex items-center gap-2">
          <PresetBar />
          <FreshnessPill />
          <ThemeToggle />
          <Button variant="ghost" size="icon-sm" aria-label="Help" onClick={() => setHelp(true)}>
            <HelpCircle className="size-4" />
          </Button>
        </div>
      </GlassPanel>
      <HelpModal open={help} onOpenChange={setHelp} />
    </header>
  );
}
```
> If `HelpModal` currently owns its own trigger/state, refactor it to a controlled `open`/`onOpenChange` dialog (it already uses the shadcn `Dialog`). Strip the `bg-background/95` wrapper from `ThemeToggle` if it now sits in the bar (optional polish).

- [ ] **Step 5: Manual verify + build.** Presets change the window (KPIs + map update). Freshness pill shows status. Theme toggles. Help opens. `npm run build` → success.

- [ ] **Step 6: Commit.**
```bash
git add assets/components/dashboard/Brand.tsx assets/components/dashboard/PresetBar.tsx assets/components/dashboard/FreshnessPill.tsx assets/components/dashboard/TopBar.tsx assets/components/map/ThemeToggle.tsx assets/components/HelpModal.tsx
git commit -m "feat(dashboard): TopBar with brand, presets, freshness pill, theme, help"
```

---

## Task 10: Analytics dock (tabs + Overview/Risk) + relocate filters

**Files:**
- Create: `assets/components/dashboard/AnalyticsDock.tsx`, `OverviewTab.tsx`, `RiskTab.tsx`
- Reuse: existing cards + `assets/components/analytics/shared.ts` (`inWindow`)

- [ ] **Step 1: Read `assets/components/analytics/AnalyticsPanel.tsx`** to copy how it slices `timeseries`/`risk` to `windowRows` via `inWindow()` and which props each card takes.

- [ ] **Step 2: Create `OverviewTab.tsx`** — reuse the existing cards with window-sliced data (pull loaded data + window from the store the same way MapView/AnalyticsPanel did):
```tsx
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { inWindow } from "@/components/analytics/shared";
import { FiresOverTimeCard } from "@/components/analytics/FiresOverTimeCard";
import { SourceBreakdownCard } from "@/components/analytics/SourceBreakdownCard";
import { FrpDistributionCard } from "@/components/analytics/FrpDistributionCard";

export function OverviewTab() {
  const { timeseries, stats, window } = useAppStore(useShallow((s) => ({
    timeseries: s.timeseries, stats: s.stats, window: s.timeWindow,
  })));
  // extract loaded data + slice exactly as AnalyticsPanel does:
  const tsData = timeseries.data;           // adapt to real accessor
  const rows = tsData && window ? inWindow(tsData.series, window) : [];
  return (
    <div className="flex flex-col gap-2">
      <FiresOverTimeCard windowRows={rows} />
      <SourceBreakdownCard windowRows={rows} />
      <FrpDistributionCard stats={stats.data} />
    </div>
  );
}
```
> Match each card's actual prop names/shapes from its source. Do not change the cards.

- [ ] **Step 3: Create `RiskTab.tsx`** — reuse `RiskTrendCard` + the `RiskDistributionBar` fed by `useKpis`:
```tsx
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { inWindow } from "@/components/analytics/shared";
import { RiskTrendCard } from "@/components/analytics/RiskTrendCard";
import { RiskDistributionBar } from "./RiskDistributionBar";
import { useKpis } from "./useKpis";

export function RiskTab() {
  const { risk, window } = useAppStore(useShallow((s) => ({ risk: s.risk, window: s.timeWindow })));
  const rows = risk.data && window ? inWindow(risk.data.series, window) : [];
  const k = useKpis();
  return (
    <div className="flex flex-col gap-3">
      <RiskTrendCard riskRows={rows} />
      <div className="px-1">
        <div className="mb-1 text-[0.7rem] uppercase tracking-wider text-muted-foreground">
          Risk distribution
        </div>
        <RiskDistributionBar distribution={k.riskDistribution} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `AnalyticsDock.tsx`** — collapsible, tabbed, localStorage-persisted. `TowersTab` comes in Task 11 (use a stub import now or implement 11 first; recommended order is 10 then 11, so temporarily render a placeholder `<div>` for the Towers tab and replace it in Task 11):
```tsx
import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassPanel } from "./GlassPanel";
import { OverviewTab } from "./OverviewTab";
import { RiskTab } from "./RiskTab";
import { TowersTab } from "./TowersTab";   // Task 11

const KEY = "watchtower:dock";

export function AnalyticsDock() {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("overview");
  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) { try { const s = JSON.parse(raw); setOpen(s.open ?? true); setTab(s.tab ?? "overview"); } catch {} }
  }, []);
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify({ open, tab })); }, [open, tab]);

  if (!open) {
    return (
      <Button variant="ghost" size="icon-sm" aria-label="Open analytics"
        onClick={() => setOpen(true)}
        className="absolute right-2 top-2 z-10 border border-surface-border bg-surface backdrop-blur-md">
        <PanelRightOpen className="size-4" />
      </Button>
    );
  }
  return (
    <GlassPanel className="z-10 m-2 ml-0 flex w-[340px] max-w-[92vw] flex-col rounded-xl">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-surface-border p-2">
          <TabsList className="bg-muted/40">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="towers">Towers</TabsTrigger>
            <TabsTrigger value="risk">Risk</TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="icon-sm" aria-label="Collapse analytics" onClick={() => setOpen(false)}>
            <PanelRightClose className="size-4" />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            <TabsContent value="overview" className="mt-0"><OverviewTab /></TabsContent>
            <TabsContent value="towers" className="mt-0"><TowersTab /></TabsContent>
            <TabsContent value="risk" className="mt-0"><RiskTab /></TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </GlassPanel>
  );
}
```
> The dock is a flex sibling of the map in the shell body (not absolute), so it never overlaps the timeline. The collapsed state uses an absolute button so the map reclaims width.

- [ ] **Step 5: Manual verify + build** (Overview + Risk tabs render real charts; collapse/expand persists). Implement Task 11 before final verification of the Towers tab.

- [ ] **Step 6: Commit.**
```bash
git add assets/components/dashboard/AnalyticsDock.tsx assets/components/dashboard/OverviewTab.tsx assets/components/dashboard/RiskTab.tsx
git commit -m "feat(dashboard): collapsible tabbed analytics dock (Overview/Risk)"
```

---

## Task 11: Towers tab — filters + sortable leaderboard (with test)

**Files:**
- Create: `assets/components/dashboard/TowersTab.tsx`, `TowerLeaderboard.tsx`
- Test: `assets/components/dashboard/TowerLeaderboard.test.tsx`
- Modify: `assets/components/map/FilterSearchControl.tsx` (extract the filter controls so they can be reused in the dock; keep the search input on the map)

- [ ] **Step 1: Read `FilterSearchControl.tsx`.** Identify the filter sub-controls (state toggle group, min fire count, has-active-fire switch) and the store actions they call. Extract them into a reusable `<TowerFilters />` (either a new export from that file or a new `dashboard/TowerFilters.tsx`). Leave the search input rendered on the map (top-left).

- [ ] **Step 2: Create `TowerLeaderboard.tsx`:**
```tsx
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { buildLeaderboard, sortLeaderboard, type LeaderboardSort } from "./leaderboard";
import { Badge } from "@/components/ui/badge";
import { riskColor, RISK_LABELS } from "@/lib/mapStyle";   // confirm exports
import { cn } from "@/lib/utils";

const SORTS: { key: LeaderboardSort; label: string }[] = [
  { key: "fires", label: "Fires" }, { key: "risk", label: "Risk" },
  { key: "ignition", label: "ML" }, { key: "name", label: "Name" },
];

export function TowerLeaderboard() {
  const { towers, stats, focusTower } = useAppStore(useShallow((s) => ({
    towers: s.towers, stats: s.stats, focusTower: s.focusTower,
  })));
  const [sort, setSort] = useState<LeaderboardSort>("fires");
  const rows = useMemo(
    () => sortLeaderboard(buildLeaderboard(towers.data, stats.data), sort),  // adapt accessor
    [towers, stats, sort],
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-0.5 rounded-md border border-surface-border bg-muted/40 p-0.5">
        {SORTS.map((s) => (
          <button key={s.key} onClick={() => setSort(s.key)}
            className={cn("flex-1 rounded px-1.5 py-1 text-[0.7rem] font-medium",
              sort === s.key ? "bg-ember text-ember-foreground" : "text-muted-foreground hover:text-foreground")}>
            {s.label}
          </button>
        ))}
      </div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id}>
            <button onClick={() => focusTower(r.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent">
              <span className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: riskColor(r.riskLevel) }} />
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              {r.state && <span className="text-muted-foreground">{r.state}</span>}
              <span className="tabular-nums">{r.fireCount}🔥</span>
              {r.ignitionProbability != null &&
                <Badge variant="secondary" className="tabular-nums">
                  {Math.round(r.ignitionProbability * 100)}%
                </Badge>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```
> Confirm `riskColor` accepts `RiskLevel | null` and returns the unknown color for null (it does per `lib/mapStyle.ts`).

- [ ] **Step 3: Create `TowersTab.tsx`:**
```tsx
import { TowerFilters } from "@/components/map/FilterSearchControl";   // or new path from Step 1
import { TowerLeaderboard } from "./TowerLeaderboard";

export function TowersTab() {
  return (
    <div className="flex flex-col gap-3">
      <TowerFilters />
      <TowerLeaderboard />
    </div>
  );
}
```

- [ ] **Step 4: Wire the focus → map fly-to.** Create a null-rendering `TowerFocuser` inside MapView (it has map context). It watches `focusedTowerId`, looks up the tower coords in the `towers` collection, calls `map.flyTo({ center, zoom: 11 })`, triggers the existing tower-popup selection, then `clearFocusedTower()`. Add `<TowerFocuser />` among MapView's map children.
```tsx
// assets/components/map/TowerFocuser.tsx
import { useEffect } from "react";
import { useMap } from "@/components/ui/map";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";

export function TowerFocuser() {
  const map = useMap();
  const { focusedTowerId, towers, clearFocusedTower } = useAppStore(useShallow((s) => ({
    focusedTowerId: s.focusedTowerId, towers: s.towers, clearFocusedTower: s.clearFocusedTower,
  })));
  useEffect(() => {
    if (focusedTowerId == null || !map) return;
    const f = towers.data?.features.find((t) => t.properties.id === focusedTowerId);  // adapt accessor
    if (f) {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      map.flyTo({ center: [lng, lat], zoom: 11 });
    }
    clearFocusedTower();
  }, [focusedTowerId, map, towers, clearFocusedTower]);
  return null;
}
```
> If `useMap()` returns a context object, adapt to its real shape (read `assets/components/ui/map.tsx`). Optionally also set the selected-tower so the popup opens.

- [ ] **Step 5: Write `TowerLeaderboard.test.tsx`** — stub the store so a row click calls `focusTower`:
```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const focusTower = vi.fn();
vi.mock("@/store/appStore", () => ({
  useAppStore: (sel: any) => sel({
    towers: { data: { type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [-120, 39] },
        properties: { id: 7, name: "Cedar Peak", state: "CA", risk_level: "high",
          risk_score: 70, ignition_probability: 0.4, fire_count: 5 } },
    ] } },
    stats: { data: { per_tower: [{ id: 7, name: "Cedar Peak", count: 5 }], frp_buckets: [] } },
    focusTower,
  }),
}));
vi.mock("@/lib/mapStyle", () => ({ riskColor: () => "#f00", RISK_LABELS: {} }));

import { TowerLeaderboard } from "./TowerLeaderboard";

describe("TowerLeaderboard", () => {
  it("renders a tower row and focuses it on click", () => {
    render(<TowerLeaderboard />);
    fireEvent.click(screen.getByText("Cedar Peak"));
    expect(focusTower).toHaveBeenCalledWith(7);
  });
});
```
> If `useAppStore` is used with `useShallow`, the simple `sel(state)` mock still works because `useShallow` just wraps the selector.

- [ ] **Step 6: Run tests + build.** `npx vitest run assets/components/dashboard/TowerLeaderboard.test.tsx` → PASS. `npm run build` → success. Manual: clicking a leaderboard row flies the map to that tower.

- [ ] **Step 7: Commit.**
```bash
git add assets/components/dashboard/TowersTab.tsx assets/components/dashboard/TowerLeaderboard.tsx assets/components/dashboard/TowerLeaderboard.test.tsx assets/components/map/TowerFocuser.tsx assets/components/map/MapView.tsx assets/components/map/FilterSearchControl.tsx
git commit -m "feat(dashboard): Towers tab — filters + sortable leaderboard with fly-to"
```

---

## Task 12: Timeline dock + legend popover + map control polish

**Files:**
- Create: `assets/components/dashboard/TimelineDock.tsx`
- Modify: `assets/components/analytics/TimeRangeControl.tsx` (remove preset row; expose the brush histogram), `assets/components/map/MapLegend.tsx` (card → popover)

- [ ] **Step 1: Refactor the timeline.** Read `TimeRangeControl.tsx`. Remove the preset-button row (presets now live in TopBar). Keep the brushable BarChart + window label + a reset. Either rename it to `TimelineDock` or wrap it. The dock derives `dense` daily totals from the store (move MapView's old `dense` derivation here):
```tsx
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { denseDailyTotals } from "@/lib/time";
import { GlassPanel } from "./GlassPanel";
// ...reuse the existing BarChart + Brush JSX from TimeRangeControl...

export function TimelineDock() {
  const { timeseries, window, setWindow, setPreset } = useAppStore(useShallow((s) => ({
    timeseries: s.timeseries, window: s.timeWindow, setWindow: s.setWindow, setPreset: s.setPreset,
  })));
  const ts = timeseries.data;   // adapt accessor
  const dense = ts ? denseDailyTotals(ts.series, ts.min_date, ts.max_date) : [];
  return (
    <GlassPanel className="z-20 flex items-center gap-3 rounded-none border-x-0 border-b-0 px-3 py-1.5">
      {/* window label + reset (setPreset("all")) + the existing brush BarChart bound to dense/window/setWindow */}
    </GlassPanel>
  );
}
```
Keep the brush → `setWindow` behavior identical. Ember-tint the bars (`fill: var(--ember)` or `#ef6548`) and the brush stroke.

- [ ] **Step 2: Legend → popover.** Convert `MapLegend.tsx` from an always-on card to a `Popover`: a small `Button` (Map/Info icon) docked on the map (bottom-left) that opens the existing legend content in `PopoverContent`. Keep the Help trigger out (Help now lives in TopBar). Render `<MapLegend />` inside MapView still.
```tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Map as MapIcon } from "lucide-react";
// existing legend rows reused inside PopoverContent
export function MapLegend() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Legend"
          className="absolute bottom-2 left-2 z-10 border border-surface-border bg-surface backdrop-blur-md">
          <MapIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-56">
        {/* existing legend symbol rows + risk ramp */}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Manual verify + build.** Brushing the timeline scopes the window (KPIs + map + dock all update); dragging clears the active preset highlight in TopBar. Legend opens from its button. `npm run build` → success.

- [ ] **Step 4: Commit.**
```bash
git add assets/components/dashboard/TimelineDock.tsx assets/components/analytics/TimeRangeControl.tsx assets/components/map/MapLegend.tsx assets/components/map/MapView.tsx
git commit -m "feat(dashboard): bottom timeline dock + legend popover + map control polish"
```

---

## Task 13: Glass popups, InitScreen restyle, responsive, light-mode pass

**Files:**
- Modify: `assets/components/map/TowerMarkers.tsx`, `assets/components/map/SelectedFirePopup.tsx`, `assets/components/InitScreen.tsx`, `assets/components/dashboard/AnalyticsDock.tsx` (responsive), `assets/components/dashboard/KpiStrip.tsx` (already scrolls)

- [ ] **Step 1: Glass popups.** In both popup components, replace opaque popup wrappers with the glass convention (`bg-surface backdrop-blur-md border border-surface-border rounded-lg shadow-lg`). Keep all content/logic. Verify the MapLibre popup CSS overrides in `globals.css` still make the popup container transparent so the glass shows.

- [ ] **Step 2: InitScreen restyle.** Update `InitScreen.tsx` classes to the identity: dark slate backdrop, ember flame + ember progress bar fill, keep the staged checklist logic untouched.

- [ ] **Step 3: Responsive dock.** In `AnalyticsDock`, below `lg` make the open dock an overlay drawer instead of a flex sibling: at `<1024px` render it `absolute right-0 top-0 h-full` over the map (add `lg:static lg:h-auto`), and ensure the collapse button is reachable. KPI strip already uses `overflow-x-auto`. The TopBar `PresetBar`/`FreshnessPill` should wrap or hide labels under `sm` (e.g. `hidden sm:flex` on the freshness text).

- [ ] **Step 4: Light-mode pass.** Toggle to light theme; verify glass surfaces, ember accents, risk ramp, charts, and text contrast all read well. Adjust any `border-white/10`-style hardcoded values to the `--surface-border` token so both themes work.

- [ ] **Step 5: Build + full test run.** `npm run build` → success. `npx vitest run` → all green.

- [ ] **Step 6: Commit.**
```bash
git add assets/components/map/TowerMarkers.tsx assets/components/map/SelectedFirePopup.tsx assets/components/InitScreen.tsx assets/components/dashboard/AnalyticsDock.tsx
git commit -m "feat(dashboard): glass popups, restyled init screen, responsive + light-mode pass"
```

---

## Task 14: Final sweep

- [ ] **Step 1: Dead code.** Remove `ReloadingOverlay.tsx` if unused; remove the old `AnalyticsPanel.tsx` if fully replaced by the dock (grep for imports first: `grep -rn "AnalyticsPanel\|ReloadingOverlay\|TimeRangeControl" assets`). Keep `TimeRangeControl` only if `TimelineDock` wraps it; otherwise inline and delete.

- [ ] **Step 2: Full verification.** `npx vitest run` (all green) + `npm run build` (success). Manually walk the spec's acceptance: TopBar presets, KPI strip live values, three dock tabs, leaderboard fly-to, timeline brush, legend popover, theme + basemap sync, popups, init gate, ingestion pill.

- [ ] **Step 3: Commit any cleanup.**
```bash
git add -A
git commit -m "chore(dashboard): remove superseded panel/overlay; final verification"
```

---

## Self-review notes (author)

- **Spec coverage:** TopBar (T9) · KPI strip + 5 metrics (T3,T6,T7) · map hero + native controls (T8,T12) · analytics dock Overview/Towers/Risk (T10,T11) · timeline (T12) · identity tokens/glass (T1) · focus fly-to (T5,T11) · states/popups/init (T13) · responsive (T13) · tests (T3,T4,T7,T11). All spec §2–§8 items map to a task.
- **Accessor caveat (called out repeatedly):** the exact loaded-data accessor on each `Loadable` (`.data` vs a `getLoadedData`/`extractLoadableData` helper) and each card's prop names must be confirmed by reading the real files; every task that touches them says so. This is the one place an executor must verify against source rather than trust the snippet.
- **No new backend, no weather endpoint, no web font** — per non-goals.
