import type { FireStats } from "@/lib/types";

import { AnalyticsCard, BarList, EmptyState } from "./AnalyticsCard";

/** Per-tower in-range detection counts (same coverage definition as the map). */
export function TowerBreakdownCard({ stats }: { stats: FireStats | null }) {
  const items = (stats?.per_tower ?? [])
    .map((t) => ({ label: t.name.replace(/ Lookout$/, ""), value: t.count }))
    .sort((a, b) => b.value - a.value);

  return (
    <AnalyticsCard title="Fires in range by tower">
      {items.length === 0 ? <EmptyState /> : <BarList items={items} />}
    </AnalyticsCard>
  );
}
