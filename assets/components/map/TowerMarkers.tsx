import { TowerControl } from "lucide-react";

import { MapMarker, MarkerContent } from "@/components/ui/map";
import { useFilteredTowers } from "@/hooks/useFilteredMapData";
import { riskColor } from "@/lib/mapStyle";
import { useAppStore } from "@/store/appStore";

/** One clickable marker per tower (filtered to the active search/filters).
 *  Clicking selects the tower, which opens its popup (SelectedTowerPopup) and
 *  lazily loads its risk. */
export function TowerMarkers() {
  const { visibleTowerCollection } = useFilteredTowers();
  const selectTower = useAppStore((s) => s.selectTower);
  if (!visibleTowerCollection) return null;
  return (
    <>
      {visibleTowerCollection.features.map((f) => {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        return (
          <MapMarker key={f.properties.id} longitude={lng} latitude={lat}>
            <MarkerContent>
              <div
                onClick={() => selectTower(f.properties.id)}
                className="flex size-7 items-center justify-center rounded-full border-2 border-white text-white shadow-md"
                style={{ backgroundColor: riskColor(f.properties.risk_level) }}
              >
                <TowerControl className="size-4" />
              </div>
            </MarkerContent>
          </MapMarker>
        );
      })}
    </>
  );
}
