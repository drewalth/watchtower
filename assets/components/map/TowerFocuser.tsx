import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { useMap } from "@/components/ui/map";
import { getLoadedData } from "@/lib/loadable";
import { useAppStore } from "@/store/appStore";

/** Null-rendering bridge inside the map context: when a tower is focused (e.g.
 *  a leaderboard row click sets focusedTowerId), fly the map to it, select it
 *  (opening the detail popup), then clear the focus so the same tower can be
 *  re-focused later. */
export function TowerFocuser() {
  const { map } = useMap();
  const { focusedTowerId, towers, selectTower, clearFocusedTower } =
    useAppStore(
      useShallow((s) => ({
        focusedTowerId: s.focusedTowerId,
        towers: getLoadedData(s.towers),
        selectTower: s.selectTower,
        clearFocusedTower: s.clearFocusedTower,
      })),
    );

  useEffect(() => {
    if (focusedTowerId == null || !map) return;
    const f = towers?.features.find(
      (t) => t.properties.id === focusedTowerId,
    );
    if (f) {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      map.flyTo({ center: [lng, lat], zoom: 11 });
      selectTower(focusedTowerId);
    }
    clearFocusedTower();
  }, [focusedTowerId, map, towers, selectTower, clearFocusedTower]);

  return null;
}
