import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { getLoadedData } from "@/lib/loadable";
import { useAppStore } from "@/store/appStore";

const SEARCH_DEBOUNCE_MS = 250;

/** Map-native tower search box. Debounced fuzzy-name search driving the shared
 *  store filter; clearing is instant. Advanced filters live in the dock's Towers
 *  tab (TowerFilters) — both read/write the same store filter state. The local
 *  draft re-syncs whenever the store's searchText changes externally (e.g. the
 *  dock's "Clear filters"). */
export function FilterSearchControl() {
  const towers = useAppStore((s) => getLoadedData(s.towers));
  const searchText = useAppStore((s) => s.filters.searchText);
  const setSearchText = useAppStore((s) => s.setSearchText);
  const setIsFiltering = useAppStore((s) => s.setIsFiltering);

  const [rawSearch, setRawSearch] = useState(searchText);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync the draft when the store value changes from elsewhere (dock reset).
  useEffect(() => {
    setRawSearch(searchText);
  }, [searchText]);

  const commitSearch = (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    setSearchText(text);
    setIsFiltering(false);
  };

  const handleSearchChange = (text: string) => {
    setRawSearch(text);
    if (text === "") {
      commitSearch("");
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsFiltering(true);
    debounceRef.current = setTimeout(
      () => commitSearch(text),
      SEARCH_DEBOUNCE_MS,
    );
  };

  // Cancel a pending commit if the control unmounts mid-debounce.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!towers) return null;

  return (
    <div className="w-[240px] max-w-[80vw]">
      <div className="relative rounded-md border border-surface-border bg-surface shadow-sm backdrop-blur-md">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={rawSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search towers…"
          aria-label="Search towers by name"
          className="h-9 border-0 bg-transparent pr-8 pl-8 shadow-none focus-visible:ring-0"
        />
        {rawSearch && (
          <button
            type="button"
            onClick={() => handleSearchChange("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
