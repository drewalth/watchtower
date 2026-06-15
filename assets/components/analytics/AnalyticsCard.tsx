import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Compact card shell for the dashboard overlay — tight padding, small title. */
export function AnalyticsCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-1.5 py-3">
      <CardHeader className="px-3">
        <CardTitle className="text-xs font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-3">{children}</CardContent>
    </Card>
  );
}

export function EmptyState({ label = "No data in range" }: { label?: string }) {
  return (
    <div className="text-muted-foreground py-3 text-center text-xs">{label}</div>
  );
}

/** A horizontal bar list (label · bar · value), scaled to the largest value.
 *  Used where a few categorical magnitudes read clearer than a chart. */
export function BarList({
  items,
}: {
  items: { label: string; value: number; color?: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground truncate">{item.label}</span>
            <span className="font-medium tabular-nums">{item.value}</span>
          </div>
          <div className="bg-muted mt-0.5 h-1.5 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(item.value / max) * 100}%`,
                backgroundColor: item.color ?? "#2b8cbe",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
