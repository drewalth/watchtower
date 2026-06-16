import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { Badge } from "@/components/ui/badge";
import { getLoadedData } from "@/lib/loadable";
import { riskColor } from "@/lib/mapStyle";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import {
  buildLeaderboard,
  sortLeaderboard,
  type LeaderboardSort,
} from "./leaderboard";

const SORTS: { key: LeaderboardSort; label: string }[] = [
  { key: "fires", label: "Fires" },
  { key: "risk", label: "Risk" },
  { key: "ignition", label: "ML" },
  { key: "name", label: "Name" },
];

/** Sortable tower leaderboard. Each row flies the map to that tower on click
 *  via the store's focusTower (TowerFocuser, in the map context, handles it). */
export function TowerLeaderboard() {
  const { towers, stats, focusTower } = useAppStore(
    useShallow((s) => ({
      towers: getLoadedData(s.towers),
      stats: getLoadedData(s.stats),
      focusTower: s.focusTower,
    })),
  );
  const [sort, setSort] = useState<LeaderboardSort>("fires");
  const rows = useMemo(
    () => sortLeaderboard(buildLeaderboard(towers, stats), sort),
    [towers, stats, sort],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-0.5 rounded-md border border-surface-border bg-muted/40 p-0.5">
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            className={cn(
              "flex-1 rounded px-1.5 py-1 text-[0.7rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              sort === s.key
                ? "bg-ember text-ember-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => focusTower(r.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: riskColor(r.riskLevel) }}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              {r.state && <span className="text-muted-foreground">{r.state}</span>}
              <span className="tabular-nums">{r.fireCount}🔥</span>
              {r.ignitionProbability != null && (
                <Badge variant="secondary" className="tabular-nums">
                  {Math.round(r.ignitionProbability * 100)}%
                </Badge>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
