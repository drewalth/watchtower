import { describe, expect, it } from "vitest";
import { computeKpis } from "./kpis";
import { shiftDays } from "@/lib/time";
import type {
  FireCollection,
  FireStats,
  FireTimeseries,
  RiskTimeseries,
  TowerCollection,
} from "@/lib/types";

const towers = {
  type: "FeatureCollection",
  features: [
    tower(1, "high"),
    tower(2, "extreme"),
    tower(3, "low"),
    tower(4, null),
    tower(5, "very_high"),
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
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-120, 39] },
    properties: { frp },
  };
}

const timeseries = {
  series: [
    { date: "2026-06-13", source: "A", count: 2 },
    { date: "2026-06-14", source: "A", count: 5 },
    { date: "2026-06-15", source: "B", count: 1 },
  ],
  min_date: "2026-06-13",
  max_date: "2026-06-15",
} as FireTimeseries;

const stats = {
  per_tower: [
    { id: 1, name: "T1", count: 7 },
    { id: 2, name: "T2", count: 0 },
    { id: 3, name: "T3", count: 3 },
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
    expect(k.towersInRange).toBe(2);
    expect(k.towersTotal).toBe(5);
  });
  it("buckets risk levels and counts elevated (high+very_high+extreme)", () => {
    const k = computeKpis({ towers, fires, stats, risk, timeseries, window });
    expect(k.riskDistribution).toEqual({
      low: 1,
      moderate: 0,
      high: 1,
      very_high: 1,
      extreme: 1,
      unknown: 1,
    });
    expect(k.elevatedRisk).toBe(3);
  });
  it("takes peak FRP ignoring nulls", () => {
    const k = computeKpis({ towers, fires, stats, risk, timeseries, window });
    expect(k.peakFrpMw).toBe(305);
  });
  it("uses the latest non-null mean ignition in window as a percent", () => {
    const k = computeKpis({ towers, fires, stats, risk, timeseries, window });
    expect(k.meanIgnitionPct).toBe(23);
  });
  it("builds a dense sparkline of per-day totals (sources collapsed) over the window", () => {
    const k = computeKpis({ towers, fires, stats, risk, timeseries, window });
    // 2026-06-13: 2, 2026-06-14: 5, 2026-06-15: 1 (A+B collapsed per day).
    expect(k.activeFiresSparkline).toEqual([2, 5, 1]);
  });
  it("zero-fills missing days and caps the sparkline at the last 14 days", () => {
    const longTs = {
      series: Array.from({ length: 20 }, (_, i) => ({
        date: shiftDays("2026-06-01", i),
        source: "A",
        count: i,
      })),
      min_date: "2026-06-01",
      max_date: "2026-06-20",
    } as FireTimeseries;
    const longWin = { start: "2026-06-01", end: "2026-06-20" };
    const k = computeKpis({
      towers,
      fires,
      stats,
      risk,
      timeseries: longTs,
      window: longWin,
    });
    // 20 dense days → sliced to the trailing 14 (counts 6..19).
    expect(k.activeFiresSparkline).toEqual([
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
  });
  it("returns an empty sparkline when timeseries or window is missing", () => {
    expect(
      computeKpis({ towers, fires, stats, risk, timeseries, window: null })
        .activeFiresSparkline,
    ).toEqual([]);
    expect(
      computeKpis({ towers, fires, stats, risk, timeseries: null, window })
        .activeFiresSparkline,
    ).toEqual([]);
  });
  it("is null-safe when everything is empty", () => {
    const k = computeKpis({
      towers: null,
      fires: null,
      stats: null,
      risk: null,
      timeseries: null,
      window: null,
    });
    expect(k.activeFires).toBe(0);
    expect(k.peakFrpMw).toBeNull();
    expect(k.meanIgnitionPct).toBeNull();
    expect(k.towersTotal).toBe(0);
  });
});
