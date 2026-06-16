import type { ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const step = 100 / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${30 - (v / max) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-7 w-full text-ember">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2}
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function StatTile({
  label, value, unit, sublabel, sparkline, children, loading,
}: {
  label: string;
  value: ReactNode;
  unit?: string | undefined;
  sublabel?: string;
  sparkline?: number[];
  children?: ReactNode;   // e.g. RiskDistributionBar
  loading?: boolean;
}) {
  return (
    <GlassPanel className="flex min-w-[9rem] flex-1 flex-col gap-1 px-3.5 py-2.5">
      <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {loading ? (
        <div className="h-7 w-16 animate-pulse rounded bg-muted" />
      ) : (
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold tabular-nums leading-none">{value}</span>
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </div>
      )}
      {sublabel && <span className="text-[0.7rem] text-muted-foreground">{sublabel}</span>}
      {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} />}
      {children}
    </GlassPanel>
  );
}
