import type { FireStats } from "@/lib/types";

import { AnalyticsCard, BarList, EmptyState } from "./AnalyticsCard";

// Hotter detections shade redder, mirroring the FRP magnitude bins server-side.
const BUCKET_COLORS = ["#fdd49e", "#fdbb84", "#fc8d59", "#e34a33", "#b30000"];

/** Fire radiative power (intensity) distribution over the window. */
export function FrpDistributionCard({ stats }: { stats: FireStats | null }) {
  const buckets = stats?.frp_buckets ?? [];
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const items = buckets.map((b, i) => ({
    label: `${b.label} MW`,
    value: b.count,
    color: BUCKET_COLORS[i % BUCKET_COLORS.length]!,
  }));

  return (
    <AnalyticsCard title="Fire intensity (FRP)">
      {total === 0 ? <EmptyState /> : <BarList items={items} />}
    </AnalyticsCard>
  );
}
