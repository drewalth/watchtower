import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFilteredTowers } from "@/hooks/useFilteredMapData";
import { getLoadedData } from "@/lib/loadable";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";

const SEARCH_DEBOUNCE_MS = 250;
const ALL_STATES = "all"; // ToggleGroup sentinel for "no state filter"

/** Top-right tower search + filters, sitting just left of the AnalyticsPanel.
 *  A clearable fuzzy-name search by default; the chevron reveals an inline panel
 *  of advanced filters (state / min fires / has-active-fire). The free-text
 *  search is debounced and drives the reloading overlay while it settles. */
export function FilterSearchControl() {
  // Select each piece individually — `filters` re-renders on filter changes;
  // the setters are stable references, so they never trigger a render.
  const towers = useAppStore((s) => getLoadedData(s.towers));
  const filters = useAppStore((s) => s.filters);
  const setSearchText = useAppStore((s) => s.setSearchText);
  const setStateFilter = useAppStore((s) => s.setStateFilter);
  const setMinFireCount = useAppStore((s) => s.setMinFireCount);
  const setHasActiveFire = useAppStore((s) => s.setHasActiveFire);
  const resetFilters = useAppStore((s) => s.resetFilters);
  const setIsFiltering = useAppStore((s) => s.setIsFiltering);
  const { visibleCount, totalCount } = useFilteredTowers();

  const [open, setOpen] = useState(false);
  const [rawSearch, setRawSearch] = useState(filters.searchText);

  // Debounce lives in the typing event handler, not in a reactive effect: typing
  // schedules the store commit; clearing commits immediately. The overlay flag is
  // raised while a commit is pending and lowered when it fires.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitSearch = (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    setSearchText(text);
    setIsFiltering(false);
  };

  const handleSearchChange = (text: string) => {
    setRawSearch(text);
    // Clearing is instant — no spinner, no debounce.
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

  // Distinct states present in the data, for the selector (e.g. CA/CO/OR/WA).
  const states = useMemo(() => {
    const set = new Set<string>();
    towers?.features.forEach((f) => {
      if (f.properties.state) set.add(f.properties.state);
    });
    return [...set].sort();
  }, [towers]);

  if (!towers) return null;

  const filtersActive =
    filters.searchText !== "" ||
    filters.state !== null ||
    filters.minFireCount > 0 ||
    filters.hasActiveFire;

  const clearAll = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    resetFilters(); // resets searchText in the store too
    setRawSearch("");
    setIsFiltering(false);
  };

  return (
    <div className="absolute top-2 right-[316px] z-10 w-[300px] max-w-[80vw]">
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="bg-background/95 flex flex-col rounded-md border shadow-sm backdrop-blur-sm"
      >
        {/* Default row: clearable search input + advanced-filters chevron. */}
        <div className="flex items-center gap-1 p-1.5">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={rawSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search towers…"
              aria-label="Search towers by name"
              className="h-8 border-0 bg-transparent pr-8 pl-8 shadow-none focus-visible:ring-0"
            />
            {rawSearch && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                aria-label="Clear search"
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Advanced filters"
              className="relative shrink-0"
            >
              <SlidersHorizontal className="size-4" />
              {filtersActive && (
                <span className="bg-primary absolute top-1 right-1 size-1.5 rounded-full" />
              )}
              <ChevronDown
                className={cn(
                  "size-3 transition-transform",
                  open && "rotate-180",
                )}
              />
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t px-3 py-3">
            {/* State selector */}
            {states.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-muted-foreground text-xs">State</Label>
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={filters.state ?? ALL_STATES}
                  onValueChange={(v) =>
                    setStateFilter(!v || v === ALL_STATES ? null : v)
                  }
                  className="w-full"
                >
                  <ToggleGroupItem value={ALL_STATES}>All</ToggleGroupItem>
                  {states.map((s) => (
                    <ToggleGroupItem key={s} value={s}>
                      {s}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )}

            {/* Minimum fire count */}
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="min-fires"
                className="text-muted-foreground text-xs"
              >
                Min fires in range
              </Label>
              <Input
                id="min-fires"
                type="number"
                min={0}
                value={filters.minFireCount || ""}
                onChange={(e) =>
                  setMinFireCount(Math.max(0, e.target.valueAsNumber || 0))
                }
                className="h-8 w-20 text-sm"
              />
            </div>

            {/* Has active fire toggle */}
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="has-active-fire"
                className="text-muted-foreground text-xs"
              >
                Has active fire(s)
              </Label>
              <Switch
                id="has-active-fire"
                checked={filters.hasActiveFire}
                onCheckedChange={setHasActiveFire}
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-muted-foreground text-xs tabular-nums">
                {visibleCount} of {totalCount} towers
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={clearAll}
                disabled={!filtersActive}
              >
                Clear filters
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
