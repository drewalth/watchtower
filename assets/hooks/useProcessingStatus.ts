import { useEffect, useRef } from "react";

import { useAppStore } from "@/store/appStore";
import {
  API,
  type IngestionStatus,
  type ProcessingStage,
  type ProcessingStageKey,
} from "@/lib/types";

/** Poll fast while work is in progress; back off once everything is done so the
 *  next hourly cycle is still caught without hammering the server. */
const FAST_INTERVAL_MS = 4000;
const SLOW_INTERVAL_MS = 30_000;

/** Side-effect hook that polls `/api/ingestion/status.json` and:
 *  1. Writes `setProcessing(stages, allDone)` into the store after each poll.
 *  2. Triggers targeted silent data refreshes when a stage transitions to
 *     "completed" (baseline-first: first observation never triggers a refresh).
 *  3. Uses adaptive scheduling — fast while work is running, slow when idle.
 *
 *  No toasts; no return value. Mount once near the app root. */
export function useProcessingStatus(): void {
  // Ref holding the previous stages map so we can detect transitions.
  const prevByKey = useRef<Map<ProcessingStageKey, ProcessingStage> | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    // We use setTimeout-based scheduling so we can adapt the delay per response.
    let timerId: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      // Skip hidden tabs — resumes on next focus via the timer still running.
      if (typeof document !== "undefined" && document.hidden) {
        schedule(FAST_INTERVAL_MS);
        return;
      }

      let nextDelay = FAST_INTERVAL_MS;
      try {
        const res = await fetch(API.ingestionStatus);
        if (cancelled) return;
        if (!res.ok) {
          schedule(FAST_INTERVAL_MS);
          return;
        }
        const payload = (await res.json()) as IngestionStatus;
        if (cancelled) return;

        const { stages, all_done } = payload;

        // Write into store.
        useAppStore.getState().setProcessing(stages, all_done);

        // Adapt polling rate.
        nextDelay = all_done ? SLOW_INTERVAL_MS : FAST_INTERVAL_MS;

        const prev = prevByKey.current;

        // Baseline: first observation — record state but never auto-refresh.
        if (prev === null) {
          prevByKey.current = stageMap(stages);
          schedule(nextDelay);
          return;
        }

        // Detect transitions → "completed" since last poll and dispatch targeted
        // refreshes. Dedupe so at most one refreshTowers and one refreshFires per
        // poll cycle.
        let needTowers = false;
        let needFires = false;

        for (const stage of stages) {
          const prevStage = prev.get(stage.key);
          const justCompleted =
            stage.status === "completed" && prevStage?.status !== "completed";

          if (!justCompleted) continue;

          switch (stage.key) {
            case "fires":
              needFires = true;
              break;
            case "risk":
            case "predictions":
            case "viewsheds":
              needTowers = true;
              break;
            // "weather" completing doesn't directly affect client-visible data
            // until risk/predictions are recomputed, so no immediate refresh.
            default:
              break;
          }
        }

        const store = useAppStore.getState();
        if (needFires) store.refreshFires();
        if (needTowers) store.refreshTowers();

        // Update the baseline for the next poll.
        prevByKey.current = stageMap(stages);
      } catch {
        // Network blip — swallow and retry at the fast rate.
        nextDelay = FAST_INTERVAL_MS;
      }

      if (!cancelled) schedule(nextDelay);
    }

    function schedule(delay: number) {
      if (timerId !== null) clearTimeout(timerId);
      timerId = setTimeout(() => void poll(), delay);
    }

    // Kick off immediately.
    void poll();

    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, []);
}

/** Build a Map<key, stage> from a stages array for O(1) lookups. */
function stageMap(
  stages: ProcessingStage[],
): Map<ProcessingStageKey, ProcessingStage> {
  const m = new Map<ProcessingStageKey, ProcessingStage>();
  for (const s of stages) {
    m.set(s.key, s);
  }
  return m;
}
