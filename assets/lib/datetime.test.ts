import { describe, expect, it } from "vitest";

import { formatDay, formatInstant, formatRelative } from "./datetime";

describe("formatDay", () => {
  it("formats a UTC calendar day, localized (en default)", () => {
    expect(formatDay("2024-06-14")).toBe("Jun 14, 2024");
  });

  it("never shifts the day regardless of host timezone", () => {
    // A year boundary is the harshest case: 2024-01-01 must not become Dec 31
    // for viewers west of UTC. UTC-fixed parsing guarantees this.
    expect(formatDay("2024-01-01")).toBe("Jan 1, 2024");
  });
});

describe("formatRelative", () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("shows a clean 'now' under a minute", () => {
    expect(formatRelative(ago(10_000))).toBe("now");
  });

  it("shows compact minutes", () => {
    expect(formatRelative(ago(5 * 60_000))).toBe("5m ago");
  });

  it("shows compact hours", () => {
    expect(formatRelative(ago(2 * 60 * 60_000))).toBe("2h ago");
  });

  it("shows compact days", () => {
    expect(formatRelative(ago(3 * 24 * 60 * 60_000))).toBe("3d ago");
  });
});

describe("formatInstant", () => {
  it("renders a non-empty localized date-time including the year", () => {
    const s = formatInstant("2024-06-14T03:45:00+00:00");
    expect(s).toContain("2024");
    expect(s.length).toBeGreaterThan(0);
  });
});
