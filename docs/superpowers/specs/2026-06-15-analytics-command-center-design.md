# Watchtower — Analytics Command Center (UI redesign)

**Date:** 2026-06-15
**Branch:** `ui-polish-exp-01`
**Status:** Approved design → implementation planning

## 1. Goal

Turn the current map UI — a full-screen MapLibre canvas with feature-rich but
scattered floating overlays in all four corners — into a cohesive **analytics
command center**: a structured dashboard shell with a header, a live KPI metric
strip, a collapsible tabbed analytics dock, and a brushable bottom timeline, all
wrapped in a dark-first "wildfire ops console" visual identity.

This is a **re-composition + new headline widgets + a visual system**, not a
rewrite. The map/data/store logic is reused as-is. No functional regressions.

### Non-goals (explicit)
- No new backend endpoints or aggregations. Build only on data already served.
- No exposing `WeatherObservation` (stretch, deferred).
- No custom web font — keep the system font stack.
- Mobile is not the target; narrow screens must degrade gracefully, not be
  first-class.

## 2. The shell — CSS grid, 4 regions

```
TopBar      brand · time-range presets · freshness pill · theme · help
KPI strip   5 headline metric tiles (window-scoped)
Body        Map (hero, 1fr)            │  Analytics dock (collapsible, tabbed)
Timeline    brushable fires/day histogram · window label · reset
```

Grid: `grid-rows-[auto_auto_1fr_auto]`; body is a flex row of map (`flex-1`) +
dock (fixed width, collapsible to an icon rail). The shell is a new top-level
component rendered by `AppInitializer` (the reveal gate is preserved).

### Region 1 — TopBar
- Flame brandmark + "WATCHTOWER" wordmark + subtitle ("wildfire lookout intel").
- **Global time-range presets** (24h / 7d / 30d / Season / All) from existing
  `lib/time.ts` `PRESETS`; drives `setPreset` in the store. Active preset
  highlighted; clears to "custom" when the timeline brush is dragged.
- **Freshness pill** — pulsing dot + "updated Nm ago" / "refreshing…" from the
  existing `useIngestionStatus` hook. Becomes the persistent indicator; the
  transient toast is kept for the refresh moment.
- Theme toggle (existing `ThemeToggle`, relocated) + Help button (existing
  `HelpModal`, content updated for the new layout).

### Region 2 — KPI strip
Five `StatTile`s, all derived from data already in the store (see §4):
1. **Active fires** — count in window + 14-day sparkline.
2. **Towers in range** — `X / 27` (towers with ≥1 in-range fire in window).
3. **Elevated risk** — count of towers at high/very_high/extreme + a segmented
   risk-ramp distribution bar.
4. **Peak FRP** — max FRP (MW) among in-window fires.
5. **Mean ML ignition** — latest mean ignition probability (%).

Tiles show a skeleton while loading, a dash when data is empty.

### Region 3 — Map (hero)
Reuses `MapView`'s layers (coverage, tower markers, fire clusters) and popups
verbatim. Map-native controls are tidied and stay docked on the map:
- Zoom / basemap / locate / fullscreen consolidated (bottom-right control group).
- A slim **search bar** (top-left) for fly-to-tower (from `FilterSearchControl`'s
  search half).
- The **legend** is demoted from an always-on card to a **popover** behind a
  button.

### Region 4 — Analytics dock (right, collapsible, tabbed)
Replaces the floating `AnalyticsPanel`. shadcn `Tabs`:
- **Overview** — `FiresOverTimeCard` (area), `SourceBreakdownCard` (donut),
  `FrpDistributionCard` (bars). Existing cards, restyled wrappers.
- **Towers** — advanced filters (state / min fire count / has-active-fire, from
  `FilterSearchControl`'s filter half) + a new **sortable tower leaderboard**
  (name · state · risk badge · window fire count · ML %). Row click → fly-to +
  open popup.
- **Risk** — `RiskTrendCard` (dual-axis risk + ML) + a `RiskDistributionBar`
  breakdown.

Collapses to a thin vertical icon rail; the map reclaims the width. State of
open/closed + active tab persisted to `localStorage`.

### Region 5 — Timeline dock (bottom)
The existing `TimeRangeControl` brush histogram, restyled full-width with the
ember accent, showing the window label and a reset. Presets move to the TopBar;
the brush remains here for fine-grained scoping.

## 3. Visual system — wildfire ops, dark-first

Add identity tokens to `assets/styles/globals.css` layered on the existing oklch
palette (existing `--primary` etc. unchanged so shadcn components are unaffected):
- `--ember` / `--ember-foreground` signature accent (`~#f59e0b` / `#ef6548`).
- Glass surface convention: `bg-background/70` + `backdrop-blur-md` + hairline
  border (`border-white/10` dark, `border-black/5` light) + soft shadow,
  packaged as a `GlassPanel` component.
- Tuned green→amber→red **risk ramp** vars used by KPI strip, leaderboard
  badges, and the risk-distribution bar (aligns with existing `mapStyle`
  RISK_COLORS, brightened for dark).
- `--chart-1..5` tuned to the fire palette for recharts.
- Metrics use `tabular-nums` + tight tracking. Tasteful motion via the installed
  `tw-animate-css` (panel/tab transitions, KPI count-up).
- Light mode remains fully supported and tested.
- The full-screen reloading blur becomes a **slim top progress bar**.

## 4. Data flow & exact KPI definitions

Reuse the Zustand store unchanged. A new pure module `dashboard/kpis.ts`
computes KPIs from loaded data; a thin `useKpis()` selector hook feeds the strip.

| KPI | Source (real fields) |
|-----|----------------------|
| Active fires | `fires` collection length (already fetched window-scoped); sparkline = last 14 days of `denseDailyTotals(timeseries.series, min, max)` |
| Towers in range | count of `stats.per_tower[]` with `count > 0`; denominator = `towers.features.length` |
| Elevated risk | count of `towers.features[].properties.risk_level ∈ {high, very_high, extreme}`; segmented bar = full distribution incl. null→unknown |
| Peak FRP | `max(frp)` over in-window `fires.features` (null-safe) |
| Mean ML ignition | latest non-null `risk.series[].mean_ignition` within window (fallback: latest overall) |

**Tower leaderboard** merges `towers.features` props (id, name, state,
risk_level, risk_score, ignition_probability) with `stats.per_tower` (window
count by id), in a pure helper (sort by fires/risk/ML/name). Row click →
`focusTower(id)`.

**Focus mechanism (new, minimal):** add `focusedTowerId: number | null` +
`focusTower(id)` to the UI slice. A small null-rendering `TowerFocuser` inside
the map context watches it, looks up the tower's coordinates from the `towers`
collection, flies there, and opens the popup (reusing existing selection).

## 5. Component inventory

**New** (`assets/components/dashboard/`): `DashboardShell`, `TopBar`, `Brand`,
`FreshnessPill`, `KpiStrip`, `StatTile`, `kpis.ts` (+ test), `AnalyticsDock`,
`OverviewTab`, `TowersTab`, `RiskTab`, `TowerLeaderboard` (+ pure sort/merge
helper & test), `RiskDistributionBar`, `GlassPanel`.

**New vendored shadcn primitives** (`assets/components/ui/`, via the existing
mapcn/shadcn convention; `radix-ui` meta-package already installed): `tabs`,
`popover`, `badge`, `tooltip`, `scroll-area`, `separator`.

**Modified:** `App.tsx`/`AppInitializer.tsx` (render `DashboardShell`, keep the
reveal gate), `MapView.tsx` (slim to map canvas + map-native overlays; remove
`AnalyticsPanel`/`TimeRangeControl` which relocate to shell regions),
`MapLegend.tsx` (card → popover), `FilterSearchControl.tsx` (split: search bar
on map, filters into the Towers tab), `ThemeToggle`/`HelpModal` (relocate /
update), `uiSlice.ts` (add focus state), `globals.css` (identity tokens),
`InitScreen.tsx` (restyle to identity), `ReloadingOverlay.tsx` (→ top progress
bar).

**Reused unchanged:** all map layers, the chart cards (FiresOverTime, Source,
Frp, RiskTrend), the data slice / loadable / time logic, geolocation, basemap.

## 6. States & resilience
- Init/reveal gate preserved (restyled). Each panel/tile handles loading
  (skeleton), empty ("No data in range"), and failed states via the existing
  `Loadable` machine.
- Toasts retained for ingestion + errors. Popups retained, restyled to glass.

## 7. Responsive
Desktop-first. `<1024px`: dock becomes an overlay drawer toggled from the
TopBar. `<640px`: KPI strip scrolls horizontally; header condenses to brand +
essential controls. Timeline persists.

## 8. Testing
- Pure unit tests (vitest, Node, matching `filterTowers.test`): `kpis.ts`
  computations and the leaderboard sort/merge helper.
- Component tests (testing-library + jsdom, matching existing `*.test.tsx`): KPI
  strip rendering across loadable states, dock tab switching, leaderboard sort &
  row-click focus.
- `ruff` not relevant (frontend only); run `npm run build` + `vitest` green.

## 9. Risks / watch-items
- Dock + timeline must not overlap on short viewports — grid rows, not absolute
  overlays, prevent this.
- Keep map performance: fires still render through `MapClusterLayer`; no
  per-fire client-side polygon work (see the "viewshed polygons are huge" note).
- Preserve viewport persistence across the MapView refactor
  (`MapViewportSync`).

## 10. Build sequence (for the plan)
1. Visual foundation: identity tokens in `globals.css`, `GlassPanel`, vendored
   primitives (tabs/popover/badge/tooltip/scroll-area/separator).
2. Shell skeleton: `DashboardShell` grid + `AppInitializer` wiring; `MapView`
   slimmed; existing panels temporarily mounted in their new regions.
3. TopBar (brand, presets, freshness pill, theme, help) + top progress bar.
4. KPI strip: `kpis.ts` + tests, `useKpis`, `StatTile`, `KpiStrip`,
   `RiskDistributionBar`.
5. Analytics dock: tabs + Overview/Towers/Risk; `TowerLeaderboard` + focus
   mechanism; relocate filters; legend → popover.
6. Timeline dock restyle; map-native control consolidation; popups → glass.
7. Polish: motion, responsive fallbacks, InitScreen restyle, light-mode pass.
8. Tests green + `npm run build`.
