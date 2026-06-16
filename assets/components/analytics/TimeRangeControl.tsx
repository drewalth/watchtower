import { Bar, BarChart, Brush } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { TimeWindow } from "@/lib/time";

import type { DayCount } from "./shared";
import { shortDate } from "./shared";

const config = {
  count: { label: "Fires", color: "var(--color-ember)" },
} satisfies ChartConfig;

/** Brushable fires-per-day histogram. Presentation-only: the brush writes a
 *  `TimeWindow` via `onWindowChange`; presets + the window label live in the
 *  containing TimelineDock. Bars/brush are ember-tinted to match the identity. */
export function TimeRangeControl({
  dense,
  window,
  onWindowChange,
}: {
  dense: DayCount[];
  window: TimeWindow;
  onWindowChange: (window: TimeWindow) => void;
}) {
  const startIndex = Math.max(
    0,
    dense.findIndex((d) => d.date >= window.start),
  );
  const afterEnd = dense.findIndex((d) => d.date > window.end);
  const endIndex =
    afterEnd === -1 ? dense.length - 1 : Math.max(startIndex, afterEnd - 1);

  const handleBrush = (range: { startIndex?: number; endIndex?: number }) => {
    if (range.startIndex == null || range.endIndex == null) return;
    const start = dense[range.startIndex]?.date;
    const end = dense[range.endIndex]?.date;
    if (start && end && (start !== window.start || end !== window.end)) {
      onWindowChange({ start, end });
    }
  };

  return (
    <ChartContainer config={config} className="h-[64px] w-full">
      <BarChart data={dense} margin={{ left: 0, right: 0, top: 2, bottom: 0 }}>
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => shortDate(String(value))}
            />
          }
        />
        <Bar dataKey="count" fill="var(--color-ember)" fillOpacity={0.7} />
        <Brush
          dataKey="date"
          height={18}
          travellerWidth={8}
          stroke="var(--color-ember)"
          startIndex={startIndex}
          endIndex={endIndex}
          onChange={handleBrush}
          tickFormatter={(value) => shortDate(String(value))}
        />
      </BarChart>
    </ChartContainer>
  );
}
