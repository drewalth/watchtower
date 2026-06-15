import type { StyleSpecification } from "maplibre-gl";

/**
 * Map basemap selection: pure data + storage helpers, no React/DOM. The default
 * light/dark styles live in the vendored Map component (Carto vector tiles);
 * here we add a satellite option and the persistence/initial-resolution logic.
 */

export type MapStyleId = "light" | "dark" | "satellite";

/** Theme used to derive the default basemap when nothing is stored. */
export type MapTheme = "light" | "dark";

/** Minimal subset of the Storage interface we depend on (injectable for tests). */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const MAP_STYLE_STORAGE_KEY = "watchtower:map-style";

/** Menu metadata. Icons are attached in the component to keep this module pure. */
export const STYLE_OPTIONS: ReadonlyArray<{ id: MapStyleId; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "satellite", label: "Satellite" },
];

const STYLE_IDS = new Set<MapStyleId>(STYLE_OPTIONS.map((o) => o.id));

function isMapStyleId(value: string | null): value is MapStyleId {
  return value != null && STYLE_IDS.has(value as MapStyleId);
}

/**
 * Esri World Imagery raster basemap — free, no API key. Reuses Carto's glyph
 * endpoint (which serves the "Open Sans" fontstack) so symbol layers such as the
 * fire cluster counts still render their labels over satellite imagery.
 */
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
  sources: {
    "esri-world-imagery": {
      type: "raster",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution:
        "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
  layers: [
    {
      id: "esri-world-imagery",
      type: "raster",
      source: "esri-world-imagery",
    },
  ],
};

/** Read a previously persisted style id, ignoring missing/invalid values. */
export function readStoredStyle(storage: StorageLike): MapStyleId | null {
  const stored = storage.getItem(MAP_STYLE_STORAGE_KEY);
  return isMapStyleId(stored) ? stored : null;
}

/** Persist the selected style id. */
export function writeStoredStyle(storage: StorageLike, id: MapStyleId): void {
  storage.setItem(MAP_STYLE_STORAGE_KEY, id);
}

/** Stored selection wins; otherwise derive the basemap from the app theme. */
export function resolveInitialStyleId(
  stored: MapStyleId | null,
  theme: MapTheme,
): MapStyleId {
  if (stored) return stored;
  return theme === "dark" ? "dark" : "light";
}
