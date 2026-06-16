import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { getLoadedData } from "@/lib/loadable";
import { inWindow } from "@/components/analytics/shared";
import { FiresOverTimeCard } from "@/components/analytics/FiresOverTimeCard";
import { SourceBreakdownCard } from "@/components/analytics/SourceBreakdownCard";
import { FrpDistributionCard } from "@/components/analytics/FrpDistributionCard";

export function OverviewTab() {
  const { timeseries, stats, timeWindow } = useAppStore(
    useShallow((s) => ({
      timeseries: getLoadedData(s.timeseries),
      stats: getLoadedData(s.stats),
      timeWindow: s.timeWindow,
    })),
  );
  const rows =
    timeseries && timeWindow
      ? inWindow(timeseries.series, timeWindow.start, timeWindow.end)
      : [];
  return (
    <div className="flex flex-col gap-2">
      <FiresOverTimeCard windowRows={rows} />
      <SourceBreakdownCard windowRows={rows} />
      <FrpDistributionCard stats={stats} />
    </div>
  );
}
