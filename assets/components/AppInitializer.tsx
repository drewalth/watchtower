import { InitScreen } from "@/components/InitScreen";
import { MapView } from "@/components/MapView";
import { selectAppReady, useAppStore } from "@/store/appStore";

/** Reveal gate: show the initialization screen until the map-critical data has
 *  loaded, then mount the map. Analytics data (risk/stats) may still be loading
 *  at reveal — the analytics cards already render null-safe placeholders. */
export function AppInitializer() {
  const ready = useAppStore(selectAppReady);
  return ready ? <MapView /> : <InitScreen />;
}
