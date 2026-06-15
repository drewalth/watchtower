// Typed contracts for the GeoJSON the Django API serves. These mirror the
// `properties` dicts built in towers/views.py.

/** API endpoints (Django routes from towers/urls.py). */
export const API = {
  towers: "/api/towers.geojson",
  fires: "/api/fires.geojson",
  /** Daily fire counts by source over the full dataset (+ min/max date). */
  firesTimeseries: "/api/fires/timeseries.json",
  /** Window-scoped per-tower counts + FRP histogram. */
  firesStats: "/api/fires/stats.json",
  /** Per-day mean FWI risk + mean ML ignition probability across towers. */
  riskTimeseries: "/api/risk/timeseries.json",
  /** Per-tower fire-risk detail (series + contributing FWI factors). */
  towerRisk: (id: number) => `/api/towers/${id}/risk.json`,
  /** Latest data-refresh run state, polled to drive the ingestion toast. */
  ingestionStatus: "/api/ingestion/status.json",
} as const;

/** Build the filtered fires URL for an inclusive date window (+ optional source). */
export function firesQuery(window: {
  start: string;
  end: string;
  source?: string;
}): string {
  const params = new URLSearchParams({ start: window.start, end: window.end });
  if (window.source) params.set("source", window.source);
  return `${API.fires}?${params.toString()}`;
}

/** Build the window-scoped fires/stats URL. */
export function statsQuery(window: { start: string; end: string }): string {
  const params = new URLSearchParams({ start: window.start, end: window.end });
  return `${API.firesStats}?${params.toString()}`;
}

/** One (day, source) bucket of detection counts (towers/views.py fires_timeseries). */
export interface FireTimeseriesDay {
  date: string;
  source: string;
  count: number;
}

export interface FireTimeseries {
  series: FireTimeseriesDay[];
  /** Earliest/latest detection day; null when the DB has no fires yet. */
  min_date: string | null;
  max_date: string | null;
}

/** Fires within one tower's coverage over the window. */
export interface TowerCount {
  id: number;
  name: string;
  count: number;
}

/** One FRP-magnitude bin (open upper bound when `max` is null). */
export interface FrpBucket {
  label: string;
  min: number;
  max: number | null;
  count: number;
}

export interface FireStats {
  per_tower: TowerCount[];
  frp_buckets: FrpBucket[];
}

/** One day of the all-tower aggregate risk/ML series (towers/views.py). */
export interface RiskTimeseriesDay {
  date: string;
  mean_risk: number | null;
  mean_ignition: number | null;
}

export interface RiskTimeseries {
  series: RiskTimeseriesDay[];
}

/** "viewshed" = terrain line-of-sight polygon; "circle" = naive radius buffer. */
export type CoverageKind = "viewshed" | "circle";

/** Canadian FWI danger classes, low → extreme (towers/models.py RiskLevel). */
export type RiskLevel = "low" | "moderate" | "high" | "very_high" | "extreme";

/** Latest ML ignition prediction; every field null until a model is trained. */
export interface PredictionSummary {
  ignition_probability: number | null;
  horizon_days: number | null;
  model_version: string | null;
}

export interface TowerProps extends PredictionSummary {
  id: number;
  name: string;
  /** USPS two-letter state code (e.g. "CA"); "" if not set. */
  state: string;
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

/** A data-refresh cycle's state (towers/views.py ingestion_status). */
export type IngestionRunStatus = "running" | "completed" | "failed";

export interface IngestionRun {
  id: number;
  status: IngestionRunStatus;
  started_at: string;
  finished_at: string | null;
}

export interface IngestionStatus {
  /** The latest run, or null until the first cycle has run. */
  run: IngestionRun | null;
}

export interface FireProps {
  id: number;
  source: string;
  frp: number | null;
  confidence: string;
  brightness: number | null;
  acquired_at: string;
}

export type TowerCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  TowerProps
>;
export type FireCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  FireProps
>;
