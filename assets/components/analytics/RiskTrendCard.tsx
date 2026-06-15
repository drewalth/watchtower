import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { RiskTimeseriesDay } from "@/lib/types";

import { AnalyticsCard, EmptyState } from "./AnalyticsCard";
import { shortDate } from "./shared";

const RISK_COLOR = "#f3722c";
const IGNITION_COLOR = "#9d4edd";
const config = {
  mean_risk: { label: "FWI risk", color: RISK_COLOR },
  mean_ignition: { label: "ML ignition", color: IGNITION_COLOR },
} satisfies ChartConfig;

/** All-tower mean FWI risk (0–100, left axis) and mean ML ignition probability
 *  (0–1, right axis) across the window — the deterministic index vs. the model. */
export function RiskTrendCard({ riskRows }: { riskRows: RiskTimeseriesDay[] }) {
  const hasIgnition = riskRows.some((d) => d.mean_ignition !== null);

  return (
    <AnalyticsCard title="Risk & ML trend">
      {riskRows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ChartContainer config={config} className="h-[96px] w-full">
            <LineChart data={riskRows} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="date" hide />
              <YAxis yAxisId="risk" domain={[0, 100]} hide />
              <YAxis yAxisId="ign" orientation="right" domain={[0, 1]} hide />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => shortDate(String(value))}
                  />
                }
              />
              <Line
                yAxisId="risk"
                dataKey="mean_risk"
                type="monotone"
                stroke="var(--color-mean_risk)"
                strokeWidth={2}
                dot={false}
              />
              {hasIgnition && (
                <Line
                  yAxisId="ign"
                  dataKey="mean_ignition"
                  type="monotone"
                  stroke="var(--color-mean_ignition)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              )}
            </LineChart>
          </ChartContainer>
          <div className="text-muted-foreground mt-1 flex items-center gap-3 text-[10px]">
            <Legend color={RISK_COLOR} label="FWI risk" />
            {hasIgnition ? (
              <Legend color={IGNITION_COLOR} label="ML ignition" />
            ) : (
              <span>ML: not trained yet</span>
            )}
          </div>
        </>
      )}
    </AnalyticsCard>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
