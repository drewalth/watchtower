import { useEffect, useState } from "react";

import { API, type IngestionRun, type IngestionStatus } from "@/lib/types";

/** How often to refresh the freshness pill (ms). Cheap endpoint; this is a
 *  read-only display poll, separate from the toast-driving useIngestionStatus. */
const POLL_INTERVAL_MS = 15000;

/**
 * Poll the ingest-status endpoint and return the latest run for display (the
 * freshness pill). Read-only and side-effect-free — it never toasts or triggers
 * a data refresh; that remains the job of `useIngestionStatus`, mounted once at
 * the app root. Skips polling a hidden tab and aborts in flight on unmount.
 */
export function useLatestIngestionRun(): IngestionRun | null {
  const [run, setRun] = useState<IngestionRun | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function poll() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(API.ingestionStatus, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as IngestionStatus;
        if (!cancelled) setRun(data.run);
      } catch {
        // Network blip / abort — keep the last known run and retry next tick.
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

  return run;
}
