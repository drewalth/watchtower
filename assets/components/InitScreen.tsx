import { AlertCircle, Check, Flame, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isFailed, type Loadable } from "@/lib/loadable";
import { useAppStore } from "@/store/appStore";

type LoadState = Loadable<unknown>["state"];

const ACCENT = "#ef6548";

/** A small icon reflecting one source's load state. */
function StateIcon({ state }: { state: LoadState }) {
  switch (state) {
    case "loaded":
      return <Check className="size-4 text-emerald-400" />;
    case "failed":
      return <AlertCircle className="text-destructive size-4" />;
    case "loading":
    case "reloading":
      return <Loader2 className="text-muted-foreground size-4 animate-spin" />;
    default: // "initial" — not started yet
      return <span className="bg-muted-foreground/40 size-1.5 rounded-full" />;
  }
}

/** Full-screen initialization gate: a staged checklist of each data source plus
 *  an overall progress bar, shown until the map-critical data has loaded *and*
 *  the map has painted. The bar mirrors the real reveal gate — the 3 critical
 *  data loads plus the map render (4 steps) — so 100% lands exactly when the
 *  overlay drops. Each source subscribes to only its `Loadable.state` (a
 *  primitive) to keep re-renders minimal. On a critical failure, surfaces the
 *  error + a Retry. */
export function InitScreen() {
  const towers = useAppStore((s) => s.towers.state);
  const timeseries = useAppStore((s) => s.timeseries.state);
  const fires = useAppStore((s) => s.fires.state);
  const risk = useAppStore((s) => s.risk.state);
  const stats = useAppStore((s) => s.stats.state);
  const mapReady = useAppStore((s) => s.mapReady);
  const retry = useAppStore((s) => s.retry);
  const criticalError = useAppStore((s) => {
    const critical: Loadable<unknown>[] = [s.towers, s.timeseries, s.fires];
    for (const src of critical) {
      if (isFailed(src)) return src.error;
    }
    return null;
  });

  // Critical rows gate the reveal; the rest just keep the user informed.
  const rows: { label: string; state: LoadState; critical: boolean }[] = [
    { label: "Lookout towers", state: towers, critical: true },
    { label: "Fire timeseries", state: timeseries, critical: true },
    { label: "Active fires", state: fires, critical: true },
    // The map mounts at launch and can't enter a `failed` state here, so it's a
    // simple spinner-until-painted — but it gates the reveal just like the data.
    {
      label: "Preparing map",
      state: mapReady ? "loaded" : "loading",
      critical: true,
    },
    { label: "Risk trends", state: risk, critical: false },
    { label: "Per-tower stats", state: stats, critical: false },
  ];
  const criticalLoaded = [towers, timeseries, fires].filter(
    (s) => s === "loaded",
  ).length;
  // 4 gating steps: the 3 critical data loads + the map render. 100% lands only
  // once everything that holds the overlay up is done — matching AppInitializer.
  const steps = criticalLoaded + (mapReady ? 1 : 0);
  const progress = Math.round((steps / 4) * 100);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-slate-950 p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 40%, rgba(239,101,72,0.18), transparent 70%)",
        }}
      />
      <div className="relative w-[320px] max-w-full rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-xl">
        <div className="mb-1 flex items-center gap-2">
          <Flame className="size-5" style={{ color: ACCENT }} />
          <span className="text-lg font-semibold text-slate-50">
            Watchtower
          </span>
        </div>
        <p className="mb-5 text-xs text-slate-400">Wildfire ops console</p>

        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li
              key={row.label}
              className={cn(
                "flex items-center gap-2.5 text-sm text-slate-200",
                (!row.critical || row.state === "initial") && "text-slate-500",
              )}
            >
              <span className="flex size-4 items-center justify-center">
                <StateIcon state={row.state} />
              </span>
              {row.label}
            </li>
          ))}
        </ul>

        <div className="mt-5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%`, backgroundColor: ACCENT }}
            />
          </div>
          <div className="mt-1.5 text-right text-xs tabular-nums text-slate-400">
            {progress}%
          </div>
        </div>

        {criticalError && (
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="mb-2 text-xs text-destructive">
              Couldn&rsquo;t load map data: {criticalError}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={retry}
              className="border-white/20 text-slate-100 hover:bg-white/10 hover:text-white"
            >
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
