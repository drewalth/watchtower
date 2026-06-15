import { useEffect } from "react";

import { useMap } from "@/components/ui/map";
import { useAppStore } from "@/store/appStore";

/** Reports map readiness up to the store so AppInitializer can drop the init
 *  overlay only once the map has fully loaded. Lives inside <Map> because
 *  `useMap()` isn't reachable from the parent; latches via `setMapReady`. */
export function MapReadyReporter() {
  const { isLoaded } = useMap();
  const setMapReady = useAppStore((s) => s.setMapReady);

  useEffect(() => {
    if (isLoaded) setMapReady();
  }, [isLoaded, setMapReady]);

  return null;
}
