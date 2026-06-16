import type { AppStateCreator, UiSlice } from "./types";

export const createUiSlice: AppStateCreator<UiSlice> = (set) => ({
  selectedFire: null,
  viewport: null,
  mapReady: false,

  selectFire: (fire) =>
    set((s) => {
      s.selectedFire = fire;
    }),

  setViewport: (viewport) =>
    set((s) => {
      s.viewport = viewport;
    }),

  setMapReady: () =>
    set((s) => {
      s.mapReady = true;
    }),

  focusedTowerId: null,
  focusTower: (id) =>
    set((s) => {
      s.focusedTowerId = id;
    }),
  clearFocusedTower: () =>
    set((s) => {
      s.focusedTowerId = null;
    }),
});
