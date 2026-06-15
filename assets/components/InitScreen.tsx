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
      return <Check className="size-4 text-emerald-600" />;
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
 *  an overall progress bar, shown until the map-critical data has loaded. Each
 *  source subscribes to only its `Loadable.state` (a primitive) to keep
 *  re-renders minimal. On a critical failure, surfaces the error + a Retry. */
export function InitScreen() {
  const towers = useAppStore((s) => s.towers.state);
  const timeseries = useAppStore((s) => s.timeseries.state);
  const fires = useAppStore((s) => s.fires.state);
  const risk = useAppStore((s) => s.risk.state);
  const stats = useAppStore((s) => s.stats.state);
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
    { label: "Risk trends", state: risk, critical: false },
    { label: "Per-tower stats", state: stats, critical: false },
  ];
  const criticalLoaded = [towers, timeseries, fires].filter(
    (s) => s === "loaded",
  ).length;
  const progress = Math.round((criticalLoaded / 3) * 100);

  return (
    <div className="bg-background text-foreground flex h-full w-full items-center justify-center p-4">
      <div className="bg-card w-[320px] max-w-full rounded-xl border p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <Flame className="size-5" style={{ color: ACCENT }} />
          <span className="text-lg font-semibold">Watchtower</span>
        </div>

        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li
              key={row.label}
              className={cn(
                "flex items-center gap-2.5 text-sm",
                (!row.critical || row.state === "initial") &&
                  "text-muted-foreground",
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
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%`, backgroundColor: ACCENT }}
            />
          </div>
          <div className="text-muted-foreground mt-1.5 text-right text-xs tabular-nums">
            {progress}%
          </div>
        </div>

        {criticalError && (
          <div className="mt-4 border-t pt-4">
            <p className="text-destructive mb-2 text-xs">
              Couldn&rsquo;t load map data: {criticalError}
            </p>
            <Button size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
