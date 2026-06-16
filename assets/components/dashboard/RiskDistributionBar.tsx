import type { RiskDistribution } from "./kpis";
import { cn } from "@/lib/utils";

const SEGMENTS: { key: keyof RiskDistribution; color: string; label: string }[] = [
  { key: "low", color: "bg-risk-low", label: "Low" },
  { key: "moderate", color: "bg-risk-moderate", label: "Moderate" },
  { key: "high", color: "bg-risk-high", label: "High" },
  { key: "very_high", color: "bg-risk-very-high", label: "Very high" },
  { key: "extreme", color: "bg-risk-extreme", label: "Extreme" },
  { key: "unknown", color: "bg-risk-unknown", label: "Unknown" },
];

export function RiskDistributionBar({
  distribution, className,
}: { distribution: RiskDistribution; className?: string }) {
  const total = SEGMENTS.reduce((n, s) => n + distribution[s.key], 0) || 1;
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {SEGMENTS.map((s) => {
        const v = distribution[s.key];
        if (!v) return null;
        return (
          <div key={s.key} className={s.color}
            style={{ width: `${(v / total) * 100}%` }}
            title={`${s.label}: ${v}`} />
        );
      })}
    </div>
  );
}
