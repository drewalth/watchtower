import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";

import { GlassPanel } from "@/components/dashboard/GlassPanel";
import { StageRow } from "@/components/status/StageRow";
import type { StageVisualState } from "@/components/status/StageRow";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import type { ProcessingStageStatus } from "@/lib/types";

/** Map a pipeline stage status to the shared StageRow visual state. */
function stageStatusToVisual(status: ProcessingStageStatus): StageVisualState {
  switch (status) {
    case "completed":
      return "done";
    case "failed":
      return "error";
    case "running":
      return "active";
    default: // "pending"
      return "idle";
  }
}

/** Select only the primitive values needed to decide visibility — avoids
 *  re-rendering when unrelated store slices change. */
function selectVisible(s: { processingStages: { status: ProcessingStageStatus }[]; processingAllDone: boolean }) {
  if (s.processingAllDone) return false;
  if (s.processingStages.length === 0) return false;
  return s.processingStages.some(
    (st) => st.status === "pending" || st.status === "running",
  );
}

/** Pill summary counts — subscribe to the full stages array only when visible. */
function useCompletedCount() {
  return useAppStore((s) => {
    const done = s.processingStages.filter(
      (st) => st.status === "completed",
    ).length;
    return { done, total: s.processingStages.length };
  });
}

/**
 * Persistent, collapsible status pill shown over the map (top-left) while any
 * ingestion stage is pending or running. Auto-hides when all stages are done.
 * Uses Radix Collapsible for accessible expand/collapse.
 */
export function ProcessingStatusPill() {
  const visible = useAppStore(selectVisible);
  const stages = useAppStore((s) => s.processingStages);
  const { done, total } = useCompletedCount();
  const [open, setOpen] = useState(false);

  if (!visible) return null;

  return (
    <GlassPanel className="w-52 pointer-events-auto">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-sm",
              "text-slate-200 hover:text-white",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              open ? "rounded-t-xl" : "rounded-xl",
            )}
            aria-expanded={open}
            aria-label={open ? "Collapse processing status" : "Expand processing status"}
          >
            <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-400" />
            <span className="flex-1 text-left text-xs font-medium leading-none">
              Preparing data&hellip;
            </span>
            <span className="tabular-nums text-xs text-slate-400">
              {done}/{total}
            </span>
            {open ? (
              <ChevronUp className="size-3.5 shrink-0 text-slate-400" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-surface-border px-3 pb-3 pt-2">
            <ul className="space-y-2">
              {stages.map((stage) => {
                const viewshedDetail =
                  stage.key === "viewsheds" &&
                  stage.total !== undefined &&
                  stage.total > 0
                    ? `${stage.done ?? 0}/${stage.total}`
                    : undefined;
                return (
                  <StageRow
                    key={stage.key}
                    state={stageStatusToVisual(stage.status)}
                    label={stage.label}
                    {...(viewshedDetail !== undefined
                      ? { detail: viewshedDetail }
                      : {})}
                    muted={stage.status === "pending"}
                  />
                );
              })}
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </GlassPanel>
  );
}
