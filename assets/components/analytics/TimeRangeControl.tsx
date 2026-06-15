import { Bar, BarChart, Brush } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { PRESETS, type PresetKey, type TimeWindow } from "@/lib/time";

import type { DayCount } from "./shared";
import { shortDate } from "./shared";

const config = {
  count: { label: "Fires", color: "#ef6548" },
} satisfies ChartConfig;

/** Bottom dock: preset buttons + a brushable fires-per-day histogram. Presets
 *  set the brush; dragging the brush overrides the preset. Both write the same
 *  `TimeWindow`, anchored to the data's real date range (see lib/time). */
export function TimeRangeControl({
  dense,
  window,
  preset,
  onWindowChange,
  onPresetChange,
}: {
  dense: DayCount[];
  window: TimeWindow;
  preset: PresetKey | null;
  onWindowChange: (window: TimeWindow) => void;
  onPresetChange: (preset: PresetKey) => void;
}) {
  const startIndex = Math.max(
    0,
    dense.findIndex((d) => d.date >= window.start),
  );
  const afterEnd = dense.findIndex((d) => d.date > window.end);
  const endIndex = afterEnd === -1 ? dense.length - 1 : Math.max(startIndex, afterEnd - 1);

  const handleBrush = (range: { startIndex?: number; endIndex?: number }) => {
    if (range.startIndex == null || range.endIndex == null) return;
    const start = dense[range.startIndex]?.date;
    const end = dense[range.endIndex]?.date;
    if (start && end && (start !== window.start || end !== window.end)) {
      onWindowChange({ start, end });
    }
  };

  return (
    <div className="bg-background/95 absolute bottom-2 left-2 z-10 w-[min(92vw,560px)] rounded-md border p-2.5 shadow-sm backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPresetChange(p.key)}
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                preset === p.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground text-xs tabular-nums">
          {shortDate(window.start)} – {shortDate(window.end)}
        </span>
      </div>

      <ChartContainer config={config} className="h-[64px] w-full">
        <BarChart data={dense} margin={{ left: 0, right: 0, top: 2, bottom: 0 }}>
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => shortDate(String(value))}
              />
            }
          />
          <Bar dataKey="count" fill="var(--color-count)" fillOpacity={0.7} />
          <Brush
            dataKey="date"
            height={18}
            travellerWidth={8}
            stroke="#ef6548"
            startIndex={startIndex}
            endIndex={endIndex}
            onChange={handleBrush}
            tickFormatter={(value) => shortDate(String(value))}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
