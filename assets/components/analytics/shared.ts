// Pure derivations shared by the analytics cards: windowing + roll-ups over the
// fire timeseries. Kept framework-free so the cards stay thin presentation.

import type { FireTimeseriesDay } from "@/lib/types";

/** Palette for per-source series/slices (fire-red first, then cool hues). */
export const SOURCE_COLORS = [
  "#ef6548",
  "#2b8cbe",
  "#f9c74f",
  "#9d4edd",
  "#43aa8b",
];

/** Filter date-keyed rows to an inclusive [start, end] window (ISO strings sort). */
export function inWindow<T extends { date: string }>(
  rows: T[],
  start: string,
  end: string,
): T[] {
  return rows.filter((r) => r.date >= start && r.date <= end);
}

export interface DayCount {
  date: string;
  count: number;
}

/** Collapse (day, source) rows to one total per day, oldest → newest. */
export function dailyTotals(rows: FireTimeseriesDay[]): DayCount[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.date, (totals.get(r.date) ?? 0) + r.count);
  return [...totals.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Total detections per source over the given rows, largest first. */
export function sourceTotals(
  rows: FireTimeseriesDay[],
): { source: string; count: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows)
    totals.set(r.source, (totals.get(r.source) ?? 0) + r.count);
  return [...totals.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

/** "VIIRS_NOAA20_SP" → "NOAA-20", "VIIRS_SNPP_NRT" → "SNPP" — compact labels. */
export function shortSource(source: string): string {
  const match = source.match(/VIIRS_(\w+?)(?:_NRT|_SP)?$/);
  const core = match?.[1] ?? source;
  return core.replace(/^NOAA(\d+)$/, "NOAA-$1");
}
