import type { FireStats, RiskLevel, TowerCollection } from "@/lib/types";

export interface LeaderboardRow {
  id: number;
  name: string;
  state: string;
  riskLevel: RiskLevel | null;
  riskScore: number | null;
  ignitionProbability: number | null;
  fireCount: number;
}
export type LeaderboardSort = "fires" | "risk" | "ignition" | "name";

export function buildLeaderboard(
  towers: TowerCollection | null,
  stats: FireStats | null,
): LeaderboardRow[] {
  const byId = new Map<number, number>();
  for (const t of stats?.per_tower ?? []) byId.set(t.id, t.count);
  return (towers?.features ?? []).map((f) => {
    const p = f.properties;
    return {
      id: p.id,
      name: p.name,
      state: p.state ?? "",
      riskLevel: (p.risk_level ?? null) as RiskLevel | null,
      riskScore: p.risk_score ?? null,
      ignitionProbability: p.ignition_probability ?? null,
      fireCount: byId.get(p.id) ?? p.fire_count ?? 0,
    };
  });
}

const nullsLast = (a: number | null, b: number | null) =>
  (b ?? -Infinity) - (a ?? -Infinity);

export function sortLeaderboard(
  rows: LeaderboardRow[],
  sort: LeaderboardSort,
): LeaderboardRow[] {
  const copy = [...rows];
  switch (sort) {
    case "fires":
      copy.sort((a, b) => b.fireCount - a.fireCount);
      break;
    case "risk":
      copy.sort((a, b) => nullsLast(a.riskScore, b.riskScore));
      break;
    case "ignition":
      copy.sort((a, b) =>
        nullsLast(a.ignitionProbability, b.ignitionProbability),
      );
      break;
    case "name":
      copy.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  return copy;
}
