import { useState } from "react";

import { HelpCircle, TowerControl } from "lucide-react";

import { HelpModal } from "@/components/HelpModal";
import {
  CIRCLE,
  RISK_COLORS,
  RISK_LABELS,
  RISK_LEVELS,
  VIEWSHED,
} from "@/lib/mapStyle";
import { getLoadedData } from "@/lib/loadable";
import { useAppStore } from "@/store/appStore";

/** A small overlay key for the map's symbols. Coverage rows show only for the
 *  kinds actually present in the data, so the legend matches what's drawn. */
export function MapLegend() {
  const towers = useAppStore((s) => getLoadedData(s.towers));
  const kinds = new Set(
    towers?.features.map((f) => f.properties.coverage_kind),
  );
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className="bg-background/95 text-foreground absolute top-2 left-2 z-10 rounded-md border p-3 text-xs shadow-sm backdrop-blur-sm">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="font-semibold">Legend</span>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label="Map help"
          className="text-muted-foreground hover:text-foreground"
        >
          <HelpCircle size={14} />
        </button>
      </div>
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
            style={{ backgroundColor: "#ef6548", border: "1px solid #d7301f" }}
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
      <HelpModal open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
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
