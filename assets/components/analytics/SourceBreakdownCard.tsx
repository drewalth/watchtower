import { Cell, Pie, PieChart } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { FireTimeseriesDay } from "@/lib/types";

import { AnalyticsCard, EmptyState } from "./AnalyticsCard";
import { SOURCE_COLORS, shortSource, sourceTotals } from "./shared";

/** Detections by VIIRS sensor over the window — donut + a compact legend. */
export function SourceBreakdownCard({
  windowRows,
}: {
  windowRows: FireTimeseriesDay[];
}) {
  const slices = sourceTotals(windowRows).map((slice, i) => ({
    ...slice,
    label: shortSource(slice.source),
    fill: SOURCE_COLORS[i % SOURCE_COLORS.length]!,
  }));
  const config: ChartConfig = Object.fromEntries(
    slices.map((s) => [s.label, { label: s.label, color: s.fill }]),
  );

  return (
    <AnalyticsCard title="By source">
      {slices.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex items-center gap-3">
          <ChartContainer
            config={config}
            className="h-[96px] w-[96px] shrink-0"
          >
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
              <Pie
                data={slices}
                dataKey="count"
                nameKey="label"
                innerRadius={26}
                outerRadius={44}
                strokeWidth={2}
              >
                {slices.map((s) => (
                  <Cell key={s.source} fill={s.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <ul className="min-w-0 flex-1 space-y-1 text-xs">
            {slices.map((s) => (
              <li key={s.source} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.fill }}
                />
                <span className="text-muted-foreground truncate">
                  {s.label}
                </span>
                <span className="ml-auto font-medium tabular-nums">
                  {s.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AnalyticsCard>
  );
}
