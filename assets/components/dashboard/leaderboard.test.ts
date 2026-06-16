import { describe, expect, it } from "vitest";
import { buildLeaderboard, sortLeaderboard } from "./leaderboard";
import type { FireStats, TowerCollection } from "@/lib/types";

const towers = {
  type: "FeatureCollection",
  features: [
    t(1, "Alpha", "CA", "low", 20, 0.1, 1),
    t(2, "Bravo", "OR", "extreme", 90, 0.8, 0),
    t(3, "Cedar", "CA", null, null, null, 4),
  ],
} as unknown as TowerCollection;

function t(
  id: number,
  name: string,
  state: string,
  lvl: string | null,
  score: number | null,
  ign: number | null,
  fc: number,
) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-120, 39] },
    properties: {
      id,
      name,
      state,
      risk_level: lvl,
      risk_score: score,
      ignition_probability: ign,
      fire_count: fc,
    },
  };
}

const stats = {
  per_tower: [
    { id: 1, name: "Alpha", count: 9 },
    { id: 2, name: "Bravo", count: 2 },
  ],
  frp_buckets: [],
} as FireStats;

describe("buildLeaderboard", () => {
  it("merges window fire counts from stats, falling back to props.fire_count", () => {
    const rows = buildLeaderboard(towers, stats);
    expect(rows.find((r) => r.id === 1)!.fireCount).toBe(9);
    expect(rows.find((r) => r.id === 3)!.fireCount).toBe(4);
  });
});

describe("sortLeaderboard", () => {
  const rows = buildLeaderboard(towers, stats);
  it("sorts by fires desc", () => {
    expect(sortLeaderboard(rows, "fires").map((r) => r.id)).toEqual([1, 3, 2]);
  });
  it("sorts by risk score desc, nulls last", () => {
    expect(sortLeaderboard(rows, "risk").map((r) => r.id)).toEqual([2, 1, 3]);
  });
  it("sorts by ignition desc, nulls last", () => {
    expect(sortLeaderboard(rows, "ignition").map((r) => r.id)).toEqual([
      2, 1, 3,
    ]);
  });
  it("sorts by name asc", () => {
    expect(sortLeaderboard(rows, "name").map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
