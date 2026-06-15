import { MapClusterLayer } from "@/components/ui/map";
import { useVisibleFireCollection } from "@/hooks/useFilteredMapData";
import { type FireProps } from "@/lib/types";
import { useAppStore } from "@/store/appStore";

/** Fire detections as a clustered layer: counts at low zoom, individual points
 *  up close (clicking one opens its popup). Clustering keeps the map responsive
 *  even when a wide window spans tens of thousands of detections. Only fires
 *  inside a visible (filtered) tower's coverage are shown. */
export function FireClusterLayer() {
  const visibleFireCollection = useVisibleFireCollection();
  const selectFire = useAppStore((s) => s.selectFire);
  if (!visibleFireCollection) return null;

  return (
    <MapClusterLayer<FireProps>
      data={visibleFireCollection}
      pointColor="#ef6548"
      clusterColors={["#fdbb84", "#ef6548", "#d7301f"]}
      onPointClick={(feature, coordinates) => {
        if (!feature.properties) return;
        selectFire({
          lng: coordinates[0],
          lat: coordinates[1],
          props: feature.properties,
        });
      }}
    />
  );
}
