// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAP_STYLE_STORAGE_KEY } from "@/lib/basemap";
import { useMapStyle } from "./useMapStyle";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  localStorage.clear();
});

describe("useMapStyle", () => {
  it("defaults to light when nothing is stored and theme is light", () => {
    const { result } = renderHook(() => useMapStyle());
    expect(result.current[0]).toBe("light");
  });

  it("restores a persisted style", () => {
    localStorage.setItem(MAP_STYLE_STORAGE_KEY, "satellite");
    const { result } = renderHook(() => useMapStyle());
    expect(result.current[0]).toBe("satellite");
  });

  it("updates state and persists the new selection", () => {
    const { result } = renderHook(() => useMapStyle());
    act(() => result.current[1]("dark"));
    expect(result.current[0]).toBe("dark");
    expect(localStorage.getItem(MAP_STYLE_STORAGE_KEY)).toBe("dark");
  });
});
