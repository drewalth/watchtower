// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const focusTower = vi.fn();

vi.mock("@/lib/loadable", () => ({
  getLoadedData: (l: { data: unknown } | null) => l?.data ?? null,
}));
vi.mock("@/lib/mapStyle", () => ({ riskColor: () => "#f00" }));
vi.mock("@/store/appStore", () => ({
  useAppStore: (sel: (s: unknown) => unknown) =>
    sel({
      towers: {
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-120, 39] },
              properties: {
                id: 7,
                name: "Cedar Peak",
                state: "CA",
                risk_level: "high",
                risk_score: 70,
                ignition_probability: 0.4,
                fire_count: 5,
              },
            },
          ],
        },
      },
      stats: {
        data: {
          per_tower: [{ id: 7, name: "Cedar Peak", count: 5 }],
          frp_buckets: [],
        },
      },
      focusTower,
    }),
}));

import { TowerLeaderboard } from "./TowerLeaderboard";

describe("TowerLeaderboard", () => {
  it("renders a tower row and focuses it on click", () => {
    render(<TowerLeaderboard />);
    fireEvent.click(screen.getByText("Cedar Peak"));
    expect(focusTower).toHaveBeenCalledWith(7);
  });
});
