// Typed contracts for the GeoJSON the Django API serves. These mirror the
// `properties` dicts built in towers/views.py.

/** API endpoints (Django routes from towers/urls.py). */
export const API = {
  towers: "/api/towers.geojson",
  fires: "/api/fires.geojson",
  /** Per-tower fire-risk detail (series + contributing FWI factors). */
  towerRisk: (id: number) => `/api/towers/${id}/risk.json`,
} as const;

/** "viewshed" = terrain line-of-sight polygon; "circle" = naive radius buffer. */
export type CoverageKind = "viewshed" | "circle";

/** Canadian FWI danger classes, low → extreme (towers/models.py RiskLevel). */
export type RiskLevel =
  | "low"
  | "moderate"
  | "high"
  | "very_high"
  | "extreme";

/** Latest ML ignition prediction; every field null until a model is trained. */
export interface PredictionSummary {
  ignition_probability: number | null;
  horizon_days: number | null;
  model_version: string | null;
}

export interface TowerProps extends PredictionSummary {
  id: number;
  name: string;
  elevation_m: number;
  coverage_radius_km: number;
  fire_count: number;
  coverage_kind: CoverageKind;
  /** Latest fire-risk rating; null until compute_fire_risk has run. */
  risk_level: RiskLevel | null;
  risk_score: number | null;
  risk_date: string | null;
  /** The coverage polygon, embedded by the API so the map can draw it. */
  coverage: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}

/** One day of the per-tower risk series (towers/views.py tower_risk). */
export interface RiskDay {
  date: string;
  risk_level: RiskLevel;
  risk_score: number;
  fwi: number;
  ffmc: number;
  dmc: number;
  dc: number;
  isi: number;
  bui: number;
  snow_covered: boolean;
}

export interface TowerRiskDetail {
  tower: { id: number; name: string; fuel_type: string };
  /** Latest ML ignition probability beside the FWI series (null-safe). */
  prediction: PredictionSummary;
  series: RiskDay[];
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
