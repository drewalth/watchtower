// Centralised, locale-aware date/time formatting via dayjs. The viewer's locale
// is detected from the browser and its dayjs locale data is lazy-loaded once at
// startup (see `initDateLocale`, called from main.tsx before first paint), so the
// formatters below render in the user's locale with no per-component plumbing.
//
// Two value kinds, deliberately handled differently:
//   - Calendar days  (fire days, risk dates): stored as UTC `YYYY-MM-DD` with no
//     real clock time, so they're parsed AND formatted in UTC. "Jun 14" stays
//     Jun 14 for every viewer; only the format localises — no off-by-one shift.
//   - Real instants  (fire acquisition time): formatted in the viewer's local
//     timezone, since they denote an actual moment.

import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";
import updateLocale from "dayjs/plugin/updateLocale";
import utc from "dayjs/plugin/utc";

import { LOCALE_LOADERS } from "./dayjsLocales";

dayjs.extend(utc);
dayjs.extend(localizedFormat);
dayjs.extend(relativeTime);
dayjs.extend(updateLocale);

/** Compact unit templates layered over each locale's translated past/future
 *  wrappers, so relative time reads e.g. "5m ago" (en) / "il y a 5m" (fr) rather
 *  than dayjs's verbose default ("5 minutes ago"). */
const COMPACT_UNITS = {
  s: "now",
  ss: "%ds",
  m: "1m",
  mm: "%dm",
  h: "1h",
  hh: "%dh",
  d: "1d",
  dd: "%dd",
  M: "1mo",
  MM: "%dmo",
  y: "1y",
  yy: "%dy",
};

/** Splice the compact unit templates into a locale's relativeTime config while
 *  keeping its translated `past`/`future` wrappers. */
function applyCompactRelative(name: string): void {
  const base = dayjs.Ls[name]?.relativeTime ?? {
    future: "in %s",
    past: "%s ago",
  };
  dayjs.updateLocale(name, { relativeTime: { ...base, ...COMPACT_UNITS } });
}

// Make English compact immediately at module load, so formatters work (and tests
// pass) without first awaiting `initDateLocale`. `en` is bundled with dayjs.
applyCompactRelative("en");

let active = "en";

/** The currently active dayjs locale (for callers that need locale-aware Intl). */
export function activeDateLocale(): string {
  return active;
}

/** dayjs locale candidates for a browser language tag, most specific first:
 *  "pt-BR" → ["pt-br", "pt"]. */
function candidates(tag: string): string[] {
  const lc = tag.toLowerCase();
  const base = lc.split("-")[0] ?? lc;
  return base !== lc ? [lc, base] : [lc];
}

/** Detect the viewer's locale and lazy-load its dayjs data, then activate it and
 *  re-apply the compact relative-time config. Call once before first paint
 *  (main.tsx). Falls back to English (already active) on any failure. */
export async function initDateLocale(): Promise<void> {
  const tag = typeof navigator !== "undefined" ? navigator.language : "";
  if (!tag) return;
  for (const name of candidates(tag)) {
    if (name === "en") return; // already active + compact
    const load = LOCALE_LOADERS[name];
    if (!load) continue; // not a known dayjs locale → try base subtag, else en
    try {
      await load();
      dayjs.locale(name);
      applyCompactRelative(name);
      active = name;
      return;
    } catch {
      // Chunk failed to load → try the base subtag, else fall back to English.
    }
  }
}

/** A UTC calendar-day ISO string ("2024-06-14") as a localized abbreviated date,
 *  fixed to UTC so the day never shifts. e.g. en → "Jun 14, 2024". */
export function formatDay(iso: string): string {
  return dayjs.utc(iso).format("ll");
}

/** A real instant (ISO datetime with offset) as a localized date + time in the
 *  viewer's local timezone. e.g. en → "Jun 14, 2024 3:45 AM". */
export function formatInstant(iso: string): string {
  return dayjs(iso).format("lll");
}

/** Compact, locale-aware "time ago" for a real instant. e.g. "5m ago", "2h ago".
 *  Under ~45s it reads a clean "now" (dropping the "ago" suffix). */
export function formatRelative(iso: string): string {
  const d = dayjs(iso);
  const secs = dayjs().diff(d, "second");
  if (secs >= 0 && secs < 45) return d.fromNow(true);
  return d.fromNow();
}
