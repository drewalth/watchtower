import type { RiskLevel } from "@/lib/types";

// Shared map styling tokens — the legend, the markers, and the help guide all
// read from here so their colors never drift. Kept in its own module (rather
// than in MapView) so HelpModal can import them without a circular dependency.

// Coverage colours: viewshed green, circle blue.
export const VIEWSHED = "#238b45";
export const CIRCLE = "#2b8cbe";

// Fire-risk ramp, low → extreme. Ordered for the legend scale.
export const RISK_LEVELS: RiskLevel[] = [
  "low",
  "moderate",
  "high",
  "very_high",
  "extreme",
];
export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "#2b9348",
  moderate: "#f9c74f",
  high: "#f3722c",
  very_high: "#e63946",
  extreme: "#9d0208",
};
export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
  extreme: "Extreme",
};
// No assessment yet (compute_fire_risk hasn't run): neutral slate marker.
export const RISK_UNKNOWN = "#475569";

export function riskColor(level: RiskLevel | null): string {
  return level ? RISK_COLORS[level] : RISK_UNKNOWN;
}
