// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./useKpis", () => ({
  useKpis: () => ({
    activeFires: 142,
    activeFiresSparkline: [1, 3, 2, 5, 7],
    towersInRange: 9,
    towersTotal: 27,
    elevatedRisk: 4,
    riskDistribution: {
      low: 10,
      moderate: 5,
      high: 2,
      very_high: 1,
      extreme: 1,
      unknown: 8,
    },
    peakFrpMw: 312,
    meanIgnitionPct: 23,
  }),
}));

import { KpiStrip } from "./KpiStrip";

describe("KpiStrip", () => {
  it("renders all five headline metrics", () => {
    render(<KpiStrip />);
    expect(screen.getByText("142")).toBeTruthy();
    expect(screen.getByText("/ 27")).toBeTruthy();
    expect(screen.getByText("312")).toBeTruthy();
    expect(screen.getByText("Active fires")).toBeTruthy();
  });
});
