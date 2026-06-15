import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { FireTimeseriesDay } from "@/lib/types";

import { AnalyticsCard, EmptyState } from "./AnalyticsCard";
import { dailyTotals, shortDate } from "./shared";

const config = {
  count: { label: "Fires", color: "#ef6548" },
} satisfies ChartConfig;

/** Daily detection counts within the selected window as an area chart. */
export function FiresOverTimeCard({
  windowRows,
}: {
  windowRows: FireTimeseriesDay[];
}) {
  const data = dailyTotals(windowRows);
  return (
    <AnalyticsCard title="Detections / day">
      {data.length === 0 ? (
        <EmptyState />
      ) : (
        <ChartContainer config={config} className="h-[90px] w-full">
          <AreaChart
            data={data}
            margin={{ left: 0, right: 0, top: 4, bottom: 0 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="date" hide />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => shortDate(String(value))}
                />
              }
            />
            <Area
              dataKey="count"
              type="natural"
              stroke="var(--color-count)"
              fill="var(--color-count)"
              fillOpacity={0.2}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </AnalyticsCard>
  );
}
