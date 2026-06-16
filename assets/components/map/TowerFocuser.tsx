import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { useMap } from "@/components/ui/map";
import { getLoadedData } from "@/lib/loadable";
import { useAppStore } from "@/store/appStore";

/** Null-rendering bridge inside the map context: when a tower is focused (e.g.
 *  a leaderboard row click sets focusedTowerId), fly the map to it, then clear
 *  the focus so the same tower can be re-focused later. */
export function TowerFocuser() {
  const { map } = useMap();
  const { focusedTowerId, towers, clearFocusedTower } = useAppStore(
    useShallow((s) => ({
      focusedTowerId: s.focusedTowerId,
      towers: getLoadedData(s.towers),
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
    }
    clearFocusedTower();
  }, [focusedTowerId, map, towers, clearFocusedTower]);

  return null;
}
