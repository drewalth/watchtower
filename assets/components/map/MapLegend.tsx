import { Map as MapIcon, TowerControl } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CIRCLE,
  RISK_COLORS,
  RISK_LABELS,
  RISK_LEVELS,
  VIEWSHED,
} from "@/lib/mapStyle";
import { getLoadedData } from "@/lib/loadable";
import { useAppStore } from "@/store/appStore";

/** Map symbol key, tucked into a bottom-left popover so it stays out of the way.
 *  Coverage rows show only for the kinds actually present in the data, so the
 *  legend matches what's drawn. (Help moved to the TopBar.) */
export function MapLegend() {
  const towers = useAppStore((s) => getLoadedData(s.towers));
  const kinds = new Set(
    towers?.features.map((f) => f.properties.coverage_kind),
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Legend"
          className="absolute bottom-2 left-2 z-10 border border-surface-border bg-surface backdrop-blur-md"
        >
          <MapIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-56 text-xs">
        <div className="mb-1.5 font-semibold">Legend</div>
        <ul className="space-y-1.5">
          <li className="flex items-center gap-2">
            <span className="flex size-4 items-center justify-center rounded-full border-2 border-white bg-slate-800 text-white shadow">
              <TowerControl className="size-2.5" />
            </span>
            Fire lookout
          </li>
          {kinds.has("viewshed") && (
            <li className="flex items-center gap-2">
              <Swatch color={VIEWSHED} />
              Terrain viewshed
            </li>
          )}
          {kinds.has("circle") && (
            <li className="flex items-center gap-2">
              <Swatch color={CIRCLE} />
              Coverage radius
            </li>
          )}
          <li className="flex items-center gap-2">
            <span
              className="size-3 rounded-full"
              style={{
                backgroundColor: "#ef6548",
                border: "1px solid #d7301f",
              }}
            />
            Active fire
          </li>
        </ul>
        <div className="mt-2 border-t pt-2">
          <div className="mb-1.5 font-semibold">Fire risk</div>
          <div className="flex items-center gap-1">
            {RISK_LEVELS.map((level) => (
              <span
                key={level}
                title={RISK_LABELS[level]}
                className="size-3 rounded-full border border-white/60"
                style={{ backgroundColor: RISK_COLORS[level] }}
              />
            ))}
          </div>
          <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
            <span>Low</span>
            <span>Extreme</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Filled, translucent square outlined in `color` — mirrors a coverage polygon. */
function Swatch({ color }: { color: string }) {
  return (
    <span
      className="size-3 rounded-[2px] border-2"
      style={{ borderColor: color, backgroundColor: `${color}33` }}
    />
  );
}
