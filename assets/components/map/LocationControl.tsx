import { useCallback, useMemo, useState } from "react";
import { Loader2, Locate } from "lucide-react";
import { toast } from "sonner";

import { ControlButton, ControlGroup, useMap } from "@/components/ui/map";
import {
  getCurrentCoords,
  isGeolocationSupported,
  queryPermission,
} from "@/lib/geolocation";

/**
 * Geolocation control. Feature-gated: renders nothing when the browser lacks
 * geolocation. On click it checks permission first — a blocked permission shows
 * a toast instead of silently failing; otherwise it requests the position
 * (prompting the user if undecided) and flies the map there.
 */
export function LocationControl() {
  const { map } = useMap();
  const [busy, setBusy] = useState(false);

  const supported = useMemo(
    () => typeof navigator !== "undefined" && isGeolocationSupported(navigator),
    [],
  );

  const handleClick = useCallback(async () => {
    if (!map) return;
    setBusy(true);
    try {
      const permission = await queryPermission(navigator);
      if (permission === "denied") {
        toast.error(
          "Location access is blocked. Enable it in your browser settings.",
        );
        return;
      }
      const coords = await getCurrentCoords(navigator);
      map.flyTo({
        center: [coords.longitude, coords.latitude],
        zoom: 14,
        duration: 1500,
      });
    } catch {
      toast.error("Couldn't determine your location.");
    } finally {
      setBusy(false);
    }
  }, [map]);

  if (!supported) return null;

  return (
    <ControlGroup>
      <ControlButton
        onClick={handleClick}
        label="Find my location"
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Locate className="size-4" />
        )}
      </ControlButton>
    </ControlGroup>
  );
}
