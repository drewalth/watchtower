import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { getLoadedData } from "@/lib/loadable";
import { inWindow } from "@/components/analytics/shared";
import { RiskTrendCard } from "@/components/analytics/RiskTrendCard";
import { RiskDistributionBar } from "./RiskDistributionBar";
import { useKpis } from "./useKpis";

export function RiskTab() {
  const { risk, timeWindow } = useAppStore(
    useShallow((s) => ({
      risk: getLoadedData(s.risk),
      timeWindow: s.timeWindow,
    })),
  );
  const rows =
    risk && timeWindow
      ? inWindow(risk.series, timeWindow.start, timeWindow.end)
      : [];
  const k = useKpis();
  return (
    <div className="flex flex-col gap-3">
      <RiskTrendCard riskRows={rows} />
      <div className="px-1">
        <div className="mb-1 text-[0.7rem] uppercase tracking-wider text-muted-foreground">
          Risk distribution
        </div>
        <RiskDistributionBar distribution={k.riskDistribution} />
      </div>
    </div>
  );
}
