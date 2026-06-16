import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useAppStore } from "@/store/appStore";
import {
  API,
  type IngestionStatus,
  type IngestionRunStatus,
} from "@/lib/types";

/** How often to poll the ingest-status endpoint (ms). */
const POLL_INTERVAL_MS = 5000;
/** Shared id so loading → success/error reuse (update) the same toast. */
const TOAST_ID = "ingestion-status";
/** Keep "Data refreshed" up just long enough to register the transition. */
const SUCCESS_DURATION_MS = 2500;
const ERROR_DURATION_MS = 4000;

type LastSeen = { id: number; status: IngestionRunStatus };

/**
 * Poll the data-refresh status and drive a Sonner toast: a persistent spinner
 * while a run is `running`, a "Data refreshed" checkmark (then auto-dismiss +
 * data re-fetch) on the `running` → `completed` transition this client actually
 * witnessed, and an error toast on failure.
 *
 * Side-effect only (returns nothing); mount once near the app root. The first
 * response is recorded as a baseline without toasting, so loading the page on
 * an already-finished run doesn't pop a stale toast.
 */
export function useIngestionStatus(): void {
  // Transient cross-poll state — a ref so updates never re-render.
  const lastSeen = useRef<LastSeen | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function poll() {
      // Don't poll a backgrounded tab — nothing to show, and it resumes on focus.
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(API.ingestionStatus, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const { run } = (await res.json()) as IngestionStatus;
        if (cancelled || !run) return;

        const prev = lastSeen.current;
        lastSeen.current = { id: run.id, status: run.status };

        // Baseline: first observation never toasts (could be a long-finished run).
        if (prev === null) return;
        // Nothing changed since the last poll.
        if (prev.id === run.id && prev.status === run.status) return;

        if (run.status === "running") {
          toast.loading("Refreshing data…", {
            id: TOAST_ID,
            duration: Infinity,
          });
        } else if (run.status === "completed") {
          // Only celebrate a run we watched go from running → completed.
          if (prev.id === run.id && prev.status === "running") {
            toast.success("Data refreshed", {
              id: TOAST_ID,
              duration: SUCCESS_DURATION_MS,
            });
            useAppStore.getState().refresh();
          }
        } else if (run.status === "failed") {
          if (prev.id === run.id && prev.status === "running") {
            toast.error("Data refresh failed", {
              id: TOAST_ID,
              duration: ERROR_DURATION_MS,
            });
          }
        }
      } catch {
        // Network blip / abort — swallow and try again next tick.
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);
}
