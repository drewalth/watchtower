import { useEffect, useRef } from "react";

import { useTheme } from "next-themes";

import { Map } from "@/components/ui/map";

import { CoverageLayer } from "@/components/map/CoverageLayer";
import { FilterSearchControl } from "@/components/map/FilterSearchControl";
import { FireClusterLayer } from "@/components/map/FireClusterLayer";
import { MapControls } from "@/components/map/MapControls";
import { MapLegend } from "@/components/map/MapLegend";
import { MapReadyReporter } from "@/components/map/MapReadyReporter";
import { MapViewportSync } from "@/components/map/MapViewportSync";
import { SelectedFirePopup } from "@/components/map/SelectedFirePopup";
import { TowerMarkers } from "@/components/map/TowerMarkers";
import { useMapStyle } from "@/components/map/useMapStyle";
import { SATELLITE_STYLE } from "@/lib/basemap";

// California-ish starting view; fitBounds refines it once towers load.
const CA_CENTER: [number, number] = [-120.5, 38.5];

// Stable identity so the Map's style effect doesn't re-run every render.
const MAP_STYLES = { satellite: SATELLITE_STYLE };

export function MapView() {
  const [styleId, setStyleId] = useMapStyle();

  // Theme drives the basemap: flipping light↔dark swaps positron↔dark-matter,
  // but leaves a manually-chosen Satellite basemap alone (it reads in both).
  // `styleId` is read through a ref so the effect reacts only to theme changes —
  // depending on `styleId` would re-fire after a manual dropdown pick and fight
  // the user's selection.
  const { resolvedTheme } = useTheme();
  const styleIdRef = useRef(styleId);
  styleIdRef.current = styleId;
  useEffect(() => {
    if (!resolvedTheme || styleIdRef.current === "satellite") return;
    const next = resolvedTheme === "dark" ? "dark" : "light";
    if (next !== styleIdRef.current) setStyleId(next);
  }, [resolvedTheme, setStyleId]);

  return (
    <Map
      center={CA_CENTER}
      zoom={6}
      styleId={styleId}
      styles={MAP_STYLES}
      className="h-full w-full"
    >
      <MapReadyReporter />
      <MapViewportSync styleId={styleId} />
      <MapControls styleId={styleId} onStyleChange={setStyleId} />
      <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-2">
        <MapLegend />
      </div>
      <CoverageLayer />
      <TowerMarkers />
      <FireClusterLayer />
      <FilterSearchControl />
      <SelectedFirePopup />
    </Map>
  );
}
