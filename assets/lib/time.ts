// Time-window helpers for the analytics dashboard. Windows are inclusive ISO
// date strings (YYYY-MM-DD); presets anchor to the latest detection in the data
// (`maxDate`), NOT wall-clock now — the archive ends well before today, so
// "last 7 days" of *now* would otherwise be empty.

import type { FireTimeseriesDay } from "./types";

export interface TimeWindow {
  start: string;
  end: string;
}

export type PresetKey = "24h" | "7d" | "30d" | "season" | "all";

export const PRESETS: { key: PresetKey; label: string; days: number | null }[] = [
  { key: "24h", label: "24h", days: 1 },
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "season", label: "Season", days: 180 },
  { key: "all", label: "All", days: null },
];

/** Shift an ISO date by `days` (may be negative), returning an ISO date. */
export function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The window for a preset, anchored to `maxDate` and clamped to `minDate`. */
export function presetWindow(
  preset: PresetKey,
  minDate: string,
  maxDate: string,
): TimeWindow {
  const p = PRESETS.find((x) => x.key === preset);
  if (!p || p.days === null) return { start: minDate, end: maxDate };
  const start = shiftDays(maxDate, -(p.days - 1));
  return { start: start < minDate ? minDate : start, end: maxDate };
}

/** A continuous per-day total (zero-filled across every calendar day), so the
 *  brush histogram has one bar per day and clean index↔date mapping. */
export function denseDailyTotals(
  series: FireTimeseriesDay[],
  minDate: string,
  maxDate: string,
): { date: string; count: number }[] {
  const totals = new Map<string, number>();
  for (const r of series) totals.set(r.date, (totals.get(r.date) ?? 0) + r.count);
  const out: { date: string; count: number }[] = [];
  for (let cur = minDate; cur <= maxDate; cur = shiftDays(cur, 1)) {
    out.push({ date: cur, count: totals.get(cur) ?? 0 });
  }
  return out;
}
