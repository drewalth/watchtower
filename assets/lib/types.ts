// Typed contracts for the GeoJSON the Django API serves. These mirror the
// `properties` dicts built in towers/views.py.

/** API endpoints (Django routes from towers/urls.py). */
export const API = {
  towers: "/api/towers.geojson",
  fires: "/api/fires.geojson",
} as const;

/** "viewshed" = terrain line-of-sight polygon; "circle" = naive radius buffer. */
export type CoverageKind = "viewshed" | "circle";

export interface TowerProps {
  id: number;
  name: string;
  elevation_m: number;
  coverage_radius_km: number;
  fire_count: number;
  coverage_kind: CoverageKind;
  /** The coverage polygon, embedded by the API so the map can draw it. */
  coverage: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}

export interface FireProps {
  id: number;
  source: string;
  frp: number | null;
  confidence: string;
  brightness: number | null;
  acquired_at: string;
}

export type TowerCollection = GeoJSON.FeatureCollection<GeoJSON.Point, TowerProps>;
export type FireCollection = GeoJSON.FeatureCollection<GeoJSON.Point, FireProps>;
