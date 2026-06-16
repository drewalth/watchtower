import { useLatestIngestionRun } from "@/hooks/useLatestIngestionRun";
import { formatRelative } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** Persistent data-freshness indicator: a pulsing dot while a refresh runs, else
 *  a relative "updated Nm ago" from the latest run's timestamp. */
export function FreshnessPill() {
  const run = useLatestIngestionRun();
  const running = run?.status === "running";
  const stamp = run?.finished_at ?? run?.started_at ?? null;
  const label = running
    ? "Data refreshing"
    : stamp
      ? `Data updated ${formatRelative(stamp)}`
      : "Data freshness unknown";
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 rounded-full border border-surface-border bg-muted/40 px-2.5 py-1 text-xs"
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          running ? "animate-pulse bg-ember" : "bg-risk-low",
        )}
      />
      <span className="sr-only">{label}</span>
      <span aria-hidden className="hidden text-muted-foreground sm:inline">
        {running
          ? "refreshing…"
          : stamp
            ? `updated ${formatRelative(stamp)}`
            : "—"}
      </span>
    </div>
  );
}
