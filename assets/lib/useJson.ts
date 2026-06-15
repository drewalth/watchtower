import { useEffect, useState } from "react";

/** Fetch a JSON document and keep it in state, re-fetching when `url` changes.
 *  The decoded shape is the API contract (mirrored in lib/types.ts and
 *  guaranteed server-side), so we annotate it as `T` rather than asserting it.
 *  A `null` url is a no-op (lets callers defer until a dependency is ready). */
export function useJson<T>(url: string | null): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!url) return;
    let active = true;
    fetch(url)
      .then((r): Promise<T> => r.json())
      .then((json) => {
        if (active) setData(json);
      })
      .catch((err) => console.error(`Failed to load ${url}`, err));
    return () => {
      active = false;
    };
  }, [url]);
  return data;
}
