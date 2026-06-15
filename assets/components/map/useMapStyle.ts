import { useCallback, useState } from "react";

import {
  readStoredStyle,
  resolveInitialStyleId,
  writeStoredStyle,
  type MapStyleId,
  type MapTheme,
} from "@/lib/basemap";

function detectTheme(): MapTheme {
  if (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  ) {
    return "dark";
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

/**
 * Owns the selected basemap: lazily initialized from localStorage (falling back
 * to the current theme) and persisted on every change. Returns a
 * `[styleId, setStyleId]` tuple.
 */
export function useMapStyle(): [MapStyleId, (id: MapStyleId) => void] {
  const [styleId, setStyleId] = useState<MapStyleId>(() =>
    resolveInitialStyleId(
      typeof localStorage !== "undefined"
        ? readStoredStyle(localStorage)
        : null,
      detectTheme(),
    ),
  );

  const update = useCallback((id: MapStyleId) => {
    setStyleId(id);
    if (typeof localStorage !== "undefined") writeStoredStyle(localStorage, id);
  }, []);

  return [styleId, update];
}
