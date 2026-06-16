import { useLatestIngestionRun } from "@/hooks/useLatestIngestionRun";
import { cn } from "@/lib/utils";

/** Persistent data-freshness indicator: a pulsing dot while a refresh runs, else
 *  a relative "updated Nm ago" from the latest run's timestamp. */
export function FreshnessPill() {
  const run = useLatestIngestionRun();
  const running = run?.status === "running";
  const stamp = run?.finished_at ?? run?.started_at ?? null;
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-surface-border bg-muted/40 px-2.5 py-1 text-xs">
      <span
        className={cn(
          "size-1.5 rounded-full",
          running ? "animate-pulse bg-ember" : "bg-risk-low",
        )}
      />
      <span className="hidden text-muted-foreground sm:inline">
        {running ? "refreshing…" : stamp ? `updated ${relative(stamp)}` : "—"}
      </span>
    </div>
  );
}

function relative(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
