import { MapClusterLayer } from "@/components/ui/map";
import { getLoadedData } from "@/lib/loadable";
import { type FireProps } from "@/lib/types";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";

/** Fire detections as a clustered layer: counts at low zoom, individual points
 *  up close (clicking one opens its popup). Clustering keeps the map responsive
 *  even when a wide window spans tens of thousands of detections. */
export function FireClusterLayer() {
  const { fires, selectFire } = useAppStore(
    useShallow((s) => ({
      fires: getLoadedData(s.fires),
      selectFire: s.selectFire,
    })),
  );
  if (!fires) return null;

  return (
    <MapClusterLayer<FireProps>
      data={fires}
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
