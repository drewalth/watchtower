import { MapControls as MapcnControls } from "@/components/ui/map";
import type { MapStyleId } from "@/lib/basemap";

import { LocationControl } from "./LocationControl";
import { MapStyleControl } from "./MapStyleControl";

type MapControlsProps = {
  styleId: MapStyleId;
  onStyleChange: (id: MapStyleId) => void;
};

/**
 * Project map controls: composes the vendored mapcn controls (zoom + fullscreen)
 * with our basemap switcher and geolocation button so they share one positioned
 * bottom-right stack. Keeps this wiring out of MapView.
 */
export function MapControls({ styleId, onStyleChange }: MapControlsProps) {
  return (
    <MapcnControls showZoom showFullscreen>
      <MapStyleControl styleId={styleId} onStyleChange={onStyleChange} />
      <LocationControl />
    </MapcnControls>
  );
}
