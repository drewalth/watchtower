import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFilteredTowers } from "@/hooks/useFilteredMapData";
import { getLoadedData } from "@/lib/loadable";
import { useAppStore } from "@/store/appStore";

const ALL_STATES = "all"; // ToggleGroup sentinel for "no state filter"

/** Advanced tower filters (state / min fires / has-active-fire), lifted out of
 *  the map's search control so they can live in the analytics dock's Towers tab.
 *  Reads and writes the same store filter state the map search shares. */
export function TowerFilters() {
  const towers = useAppStore((s) => getLoadedData(s.towers));
  const filters = useAppStore((s) => s.filters);
  const setStateFilter = useAppStore((s) => s.setStateFilter);
  const setMinFireCount = useAppStore((s) => s.setMinFireCount);
  const setHasActiveFire = useAppStore((s) => s.setHasActiveFire);
  const resetFilters = useAppStore((s) => s.resetFilters);
  const setIsFiltering = useAppStore((s) => s.setIsFiltering);
  const { visibleCount, totalCount } = useFilteredTowers();

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
    resetFilters(); // also clears searchText; the map search box syncs off it
    setIsFiltering(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {states.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">State</Label>
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
            <ToggleGroupItem
              value={ALL_STATES}
              className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              aria-label="All states"
            >
              All
            </ToggleGroupItem>
            {states.map((s) => (
              <ToggleGroupItem
                key={s}
                value={s}
                className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                aria-label={s}
              >
                {s}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="min-fires" className="text-xs text-muted-foreground">
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

      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="has-active-fire" className="text-xs text-muted-foreground">
          Has active fire(s)
        </Label>
        <Switch
          id="has-active-fire"
          checked={filters.hasActiveFire}
          onCheckedChange={setHasActiveFire}
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-xs text-muted-foreground tabular-nums">
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
  );
}
