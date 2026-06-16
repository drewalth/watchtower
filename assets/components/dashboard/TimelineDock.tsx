import { useShallow } from "zustand/react/shallow";

import { TimeRangeControl } from "@/components/analytics/TimeRangeControl";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/datetime";
import { getLoadedData } from "@/lib/loadable";
import { denseDailyTotals } from "@/lib/time";
import { useAppStore } from "@/store/appStore";
import { GlassPanel } from "./GlassPanel";

/** Bottom dock: a brushable fires-per-day timeline that scopes the global time
 *  window. Presets live in the TopBar; here the brush sets an arbitrary window
 *  (which clears the active preset in the store) and Reset returns to "all".
 *  Daily totals are zero-filled across the data's full date range. */
export function TimelineDock() {
  const { timeseries, timeWindow, setWindow, setPreset } = useAppStore(
    useShallow((s) => ({
      timeseries: getLoadedData(s.timeseries),
      timeWindow: s.timeWindow,
      setWindow: s.setWindow,
      setPreset: s.setPreset,
    })),
  );

  const dense =
    timeseries && timeseries.min_date && timeseries.max_date
      ? denseDailyTotals(
          timeseries.series,
          timeseries.min_date,
          timeseries.max_date,
        )
      : [];

  // Until timeseries + window are ready, hold the footer height so the grid
  // layout doesn't jump.
  if (!timeWindow || dense.length < 2) {
    return (
      <GlassPanel className="z-20 h-[72px] rounded-none border-x-0 border-b-0" />
    );
  }

  return (
    <GlassPanel className="z-20 flex items-center gap-3 rounded-none border-x-0 border-b-0 px-3 py-1.5">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatDay(timeWindow.start)} – {formatDay(timeWindow.end)}
        </span>
        <Button variant="ghost" size="xs" onClick={() => setPreset("all")}>
          Reset
        </Button>
      </div>
      <div className="min-w-0 flex-1">
        <TimeRangeControl
          dense={dense}
          window={timeWindow}
          onWindowChange={setWindow}
        />
      </div>
    </GlassPanel>
  );
}
