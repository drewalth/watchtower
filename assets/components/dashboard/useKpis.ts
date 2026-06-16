import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { getLoadedData } from "@/lib/loadable";
import { useAppStore } from "@/store/appStore";
import { computeKpis, type Kpis } from "./kpis";

export function useKpis(): Kpis {
  const { towers, fires, timeseries, risk, stats, timeWindow } = useAppStore(
    useShallow((s) => ({
      towers: getLoadedData(s.towers),
      fires: getLoadedData(s.fires),
      timeseries: getLoadedData(s.timeseries),
      risk: getLoadedData(s.risk),
      stats: getLoadedData(s.stats),
      timeWindow: s.timeWindow,
    })),
  );
  return useMemo(
    () =>
      computeKpis({
        towers,
        fires,
        timeseries,
        risk,
        stats,
        window: timeWindow,
      }),
    [towers, fires, timeseries, risk, stats, timeWindow],
  );
}
