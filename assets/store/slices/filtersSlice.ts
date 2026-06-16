import { DEFAULT_FILTERS } from "./types";
import type { AppStateCreator, FiltersSlice } from "./types";

export const createFiltersSlice: AppStateCreator<FiltersSlice> = (set) => ({
  filters: DEFAULT_FILTERS,
  isFiltering: false,

  setSearchText: (text) =>
    set((s) => {
      s.filters.searchText = text;
    }),

  setStateFilter: (state) =>
    set((s) => {
      s.filters.state = state;
    }),

  setMinFireCount: (n) =>
    set((s) => {
      s.filters.minFireCount = n;
    }),

  setHasActiveFire: (on) =>
    set((s) => {
      s.filters.hasActiveFire = on;
    }),

  resetFilters: () =>
    set((s) => {
      s.filters = DEFAULT_FILTERS;
    }),

  setIsFiltering: (on) =>
    set((s) => {
      s.isFiltering = on;
    }),
});
