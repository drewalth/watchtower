import { useEffect, useState } from "react";

import { InitScreen } from "@/components/InitScreen";
import { MapView } from "@/components/map/MapView";
import { cn } from "@/lib/utils";
import { selectAppReady, selectMapReady, useAppStore } from "@/store/appStore";

/** Reveal anyway after this long if the map never signals ready (e.g. the
 *  basemap style/tiles fail to load) — once the data is loaded — so a failed
 *  basemap can't leave the init overlay up forever. */
const REVEAL_FALLBACK_MS = 8000;
/** Brief hold after the reveal gate completes so the progress bar's 100% state
 *  is perceptible before the fade begins (otherwise it'd vanish the instant it
 *  fills). */
const REVEAL_HOLD_MS = 500;
/** Overlay fade duration; the wrapper unmounts after it elapses. Keep in sync
 *  with the `duration-*` class below. */
const FADE_MS = 400;

/** Reveal gate: the map and the init overlay mount together from launch (so the
 *  map starts loading immediately), and the overlay is dropped only once the
 *  map-critical data *and* the map itself are ready — landing the reveal on a
 *  fully painted map. Analytics data (risk/stats) may still be loading; the
 *  cards render null-safe placeholders. */
export function AppInitializer() {
  const dataReady = useAppStore(selectAppReady);
  const mapReady = useAppStore(selectMapReady);
  const [timedOut, setTimedOut] = useState(false);
  const [held, setHeld] = useState(false);

  // Safety net: if the map never reports ready, reveal once data is loaded.
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), REVEAL_FALLBACK_MS);
    return () => clearTimeout(t);
  }, []);

  const complete = dataReady && (mapReady || timedOut);

  // Once the gate completes, let the 100% bar register for a beat before fading.
  useEffect(() => {
    if (!complete) return;
    const t = setTimeout(() => setHeld(true), REVEAL_HOLD_MS);
    return () => clearTimeout(t);
  }, [complete]);

  return (
    <>
      <MapView />
      <InitOverlay hidden={held} />
    </>
  );
}

/** Full-screen init overlay above the map. Fades out when `hidden`, then
 *  unmounts so it stops painting (and stops capturing pointer events). */
function InitOverlay({ hidden }: { hidden: boolean }) {
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (!hidden) return;
    const t = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(t);
  }, [hidden]);

  if (!mounted) return null;

  return (
    <div
      className={cn(
        "absolute inset-0 z-50 transition-opacity duration-[400ms]",
        hidden ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <InitScreen />
    </div>
  );
}
