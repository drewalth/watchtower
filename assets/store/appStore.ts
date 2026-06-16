import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import { createDataSlice } from "./slices/dataSlice";
import { createFiltersSlice } from "./slices/filtersSlice";
import { createProcessingSlice } from "./slices/processingSlice";
import { createUiSlice } from "./slices/uiSlice";
import type { AppStore } from "./slices/types";

export type { AppStore, MapFilters, SelectedFire } from "./slices/types";

export const useAppStore = create<AppStore>()(
  immer((...a) => ({
    ...createDataSlice(...a),
    ...createFiltersSlice(...a),
    ...createUiSlice(...a),
    ...createProcessingSlice(...a),
  })),
);

/** The data half of the reveal gate: true once the map-critical data has
 *  loaded (latched). */
export const selectAppReady = (s: AppStore): boolean => s.ready;

/** The map half of the reveal gate: true once the MapLibre map is fully loaded
 *  (latched). */
export const selectMapReady = (s: AppStore): boolean => s.mapReady;
