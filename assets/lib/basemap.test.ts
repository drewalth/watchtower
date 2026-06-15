import { describe, expect, it } from "vitest";

import {
  MAP_STYLE_STORAGE_KEY,
  SATELLITE_STYLE,
  STYLE_OPTIONS,
  readStoredStyle,
  resolveInitialStyleId,
  writeStoredStyle,
  type StorageLike,
} from "./basemap";

function fakeStorage(initial?: string): StorageLike & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key: string) {
      return key === MAP_STYLE_STORAGE_KEY ? this.value : null;
    },
    setItem(key: string, value: string) {
      if (key === MAP_STYLE_STORAGE_KEY) this.value = value;
    },
  };
}

describe("STYLE_OPTIONS", () => {
  it("lists light, dark and satellite in order", () => {
    expect(STYLE_OPTIONS.map((o) => o.id)).toEqual([
      "light",
      "dark",
      "satellite",
    ]);
  });
});

describe("readStoredStyle", () => {
  it("returns a valid stored id", () => {
    expect(readStoredStyle(fakeStorage("satellite"))).toBe("satellite");
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredStyle(fakeStorage())).toBeNull();
  });

  it("returns null for an unrecognized value", () => {
    expect(readStoredStyle(fakeStorage("hologram"))).toBeNull();
  });
});

describe("writeStoredStyle", () => {
  it("persists the id under the storage key", () => {
    const storage = fakeStorage();
    writeStoredStyle(storage, "dark");
    expect(storage.value).toBe("dark");
  });
});

describe("resolveInitialStyleId", () => {
  it("prefers a valid stored id over the theme", () => {
    expect(resolveInitialStyleId("satellite", "light")).toBe("satellite");
  });

  it("falls back to dark when the theme is dark and nothing is stored", () => {
    expect(resolveInitialStyleId(null, "dark")).toBe("dark");
  });

  it("falls back to light otherwise", () => {
    expect(resolveInitialStyleId(null, "light")).toBe("light");
  });
});

describe("SATELLITE_STYLE", () => {
  it("is a raster style backed by Esri World Imagery with glyphs for labels", () => {
    expect(SATELLITE_STYLE.version).toBe(8);
    expect(SATELLITE_STYLE.glyphs).toBeTruthy();
    const sources = Object.values(SATELLITE_STYLE.sources);
    const raster = sources.find((s) => s.type === "raster");
    expect(raster).toBeTruthy();
    expect(JSON.stringify(raster)).toContain("arcgisonline.com");
  });
});
