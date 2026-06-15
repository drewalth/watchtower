import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import { useMap, type MapViewport } from "@/components/ui/map";
import type { MapStyleId } from "@/lib/basemap";
import { useAppStore } from "@/store/appStore";

function readViewport(map: MapLibreMap): MapViewport {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

type Props = { styleId: MapStyleId };

/**
 * Persists the live map camera into the app store and re-applies it across
 * basemap switches.
 *
 * Why this is needed: switching basemaps calls `map.setStyle()`, and the new
 * style's embedded default center/zoom snaps the camera back, discarding the
 * user's pan/zoom. We snapshot the viewport the instant `styleId` changes —
 * this child effect runs *before* the vendored <Map>'s own setStyle effect
 * (React fires child effects before parent effects), so the camera is still the
 * user's — suppress the reset's intermediate move events, then re-apply the
 * snapshot once the new style has settled.
 *
 * Lives inside <Map> because `useMap()` is only reachable from its children.
 */
export function MapViewportSync({ styleId }: Props) {
  const { map } = useMap();
  const setViewport = useAppStore((s) => s.setViewport);

  // Transient bookkeeping in refs: the viewport changes on every gesture and
  // must never trigger a React re-render of the map subtree.
  const suppressRef = useRef(false);
  const isFirstStyle = useRef(true);

  // Persist on gesture end + restore any stored viewport on (re)mount.
  useEffect(() => {
    if (!map) return;

    const stored = useAppStore.getState().viewport;
    if (stored) map.jumpTo(stored);

    const handleMoveEnd = () => {
      if (suppressRef.current) return;
      setViewport(readViewport(map));
    };

    map.on("moveend", handleMoveEnd);
    return () => {
      map.off("moveend", handleMoveEnd);
    };
  }, [map, setViewport]);

  // Preserve the camera across basemap switches.
  useEffect(() => {
    if (!map) return;
    // Nothing to preserve on the first style (initial mount).
    if (isFirstStyle.current) {
      isFirstStyle.current = false;
      return;
    }

    // Prefer the last persisted viewport (kept good because style-swap moves are
    // suppressed); fall back to the live camera if the user never moved. Read
    // here — before the parent's setStyle resets the camera — so a rapid second
    // switch still restores the user's real view, not a half-reset one.
    const target = useAppStore.getState().viewport ?? readViewport(map);

    // Ignore the move events the style swap emits while it snaps to its default.
    suppressRef.current = true;

    // The style diff applies the new style's embedded center/zoom (Carto styles
    // declare one) and snaps the camera. `styledata` fires synchronously right
    // after that — before the next paint — so re-pinning the viewport here keeps
    // the default view from ever flashing on screen.
    const pin = () => {
      map.jumpTo(target);
    };
    // `idle` fires once the new style has fully loaded and settled: detach the
    // pin, do a final restore, persist, and resume normal tracking.
    const finish = () => {
      map.off("styledata", pin);
      map.jumpTo(target);
      setViewport(target);
      suppressRef.current = false;
    };

    map.on("styledata", pin);
    map.once("idle", finish);

    return () => {
      map.off("styledata", pin);
      map.off("idle", finish);
      suppressRef.current = false;
    };
  }, [map, styleId, setViewport]);

  return null;
}
