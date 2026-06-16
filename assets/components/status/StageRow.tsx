import { AlertCircle, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Normalised visual state that both the init-screen Loadable states and the
 * processing-stage pipeline statuses map onto. Callers perform the mapping so
 * StageRow stays presentational and free of business-logic imports.
 */
export type StageVisualState = "done" | "active" | "error" | "idle";

export interface StageRowProps {
  /** Normalised visual state driving the icon. */
  state: StageVisualState;
  /** Row label text. */
  label: string;
  /** Optional trailing detail string (e.g. "12/27" for viewsheds). */
  detail?: string;
  /** When true, renders the row in a muted style (non-critical / not started). */
  muted?: boolean;
}

/** Status icon matching the normalised visual state. */
function StageIcon({ state }: { state: StageVisualState }) {
  switch (state) {
    case "done":
      return <Check className="size-4 text-emerald-400" />;
    case "error":
      return <AlertCircle className="text-destructive size-4" />;
    case "active":
      return <Loader2 className="text-muted-foreground size-4 animate-spin" />;
    default: // "idle" — pending / not started
      return <span className="bg-muted-foreground/40 size-1.5 rounded-full" />;
  }
}

/** Shared row used by both InitScreen and ProcessingStatusPill to keep the
 *  visual language consistent: status icon + label + optional trailing detail. */
export function StageRow({ state, label, detail, muted }: StageRowProps) {
  return (
    <li
      className={cn(
        "flex items-center gap-2.5 text-sm text-slate-200",
        muted && "text-slate-500",
      )}
    >
      <span className="flex size-4 items-center justify-center">
        <StageIcon state={state} />
      </span>
      <span className="flex-1">{label}</span>
      {detail !== undefined && (
        <span className="tabular-nums text-xs text-slate-400">{detail}</span>
      )}
    </li>
  );
}
