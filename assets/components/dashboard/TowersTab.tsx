import { TowerFilters } from "./TowerFilters";
import { TowerLeaderboard } from "./TowerLeaderboard";

export function TowersTab() {
  return (
    <div className="flex flex-col gap-3">
      <TowerFilters />
      <TowerLeaderboard />
    </div>
  );
}
