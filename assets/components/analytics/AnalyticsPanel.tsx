import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Flame } from "lucide-react";

import type { FireStats, FireTimeseries, RiskTimeseries } from "@/lib/types";
import type { TimeWindow } from "@/lib/time";

import { FiresOverTimeCard } from "./FiresOverTimeCard";
import { FrpDistributionCard } from "./FrpDistributionCard";
import { RiskTrendCard } from "./RiskTrendCard";
import { SourceBreakdownCard } from "./SourceBreakdownCard";
import { TowerBreakdownCard } from "./TowerBreakdownCard";
import { inWindow } from "./shared";

/** Floating, collapsible analytics overlay (top-right). Holds the windowed
 *  total headline + the dashboard cards. All charts derive from the cached
 *  full-range timeseries sliced to `window`, plus the server's window-scoped
 *  `stats` (per-tower + FRP, which can't be summed from per-day rows). */
export function AnalyticsPanel({
  timeseries,
  risk,
  stats,
  window,
}: {
  timeseries: FireTimeseries;
  risk: RiskTimeseries | null;
  stats: FireStats | null;
  window: TimeWindow;
}) {
  const [open, setOpen] = useState(false);

  const windowRows = useMemo(
    () => inWindow(timeseries.series, window.start, window.end),
    [timeseries, window],
  );
  const riskRows = useMemo(
    () => inWindow(risk?.series ?? [], window.start, window.end),
    [risk, window],
  );
  const total = windowRows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="absolute top-2 right-2 z-10 flex max-h-[calc(100%-1rem)] w-[300px] max-w-[92vw] flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-background/95 flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 shadow-sm backdrop-blur-sm"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Flame className="size-4 text-[#ef6548]" />
          Fire analytics
        </span>
        <span className="text-muted-foreground flex items-center gap-2 text-xs">
          <span className="tabular-nums">{total.toLocaleString()} fires</span>
          {open ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 overflow-y-auto pr-0.5">
          <FiresOverTimeCard windowRows={windowRows} />
          <SourceBreakdownCard windowRows={windowRows} />
          <TowerBreakdownCard stats={stats} />
          <RiskTrendCard riskRows={riskRows} />
          <FrpDistributionCard stats={stats} />
        </div>
      )}
    </div>
  );
}
