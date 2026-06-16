import { denseDailyTotals } from "@/lib/time";
import type { TimeWindow } from "@/lib/time";
import type {
  FireCollection, FireStats, FireTimeseries, RiskTimeseries,
  TowerCollection,
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
