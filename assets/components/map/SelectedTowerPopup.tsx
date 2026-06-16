import { useShallow } from "zustand/react/shallow";

import { MapPopup } from "@/components/ui/map";
import { formatDay } from "@/lib/datetime";
import { getLoadedData, isFailed } from "@/lib/loadable";
import { RISK_COLORS, RISK_LABELS } from "@/lib/mapStyle";
import { type PredictionSummary, type TowerProps } from "@/lib/types";
import { useAppStore } from "@/store/appStore";

/** The popup for the currently-selected tower. Mirrors SelectedFirePopup: a
 *  controlled MapPopup driven by `selectedTowerId`, so both a marker click and a
 *  leaderboard row click (via TowerFocuser) open the same detail popup. */
export function SelectedTowerPopup() {
  const { selectedTowerId, towers, clearSelectedTower } = useAppStore(
    useShallow((s) => ({
      selectedTowerId: s.selectedTowerId,
      towers: getLoadedData(s.towers),
      clearSelectedTower: s.clearSelectedTower,
    })),
  );
  if (selectedTowerId == null || !towers) return null;
  const feature = towers.features.find(
    (f) => f.properties.id === selectedTowerId,
  );
  if (!feature) return null;
  const [lng, lat] = feature.geometry.coordinates as [number, number];

  return (
    <MapPopup
      longitude={lng}
      latitude={lat}
      onClose={() => clearSelectedTower()}
      closeButton
      className="rounded-lg border-surface-border bg-surface text-foreground shadow-lg backdrop-blur-md"
    >
      <TowerPopup props={feature.properties} />
    </MapPopup>
  );
}

function TowerPopup({ props }: { props: TowerProps }) {
  const coverage =
    props.coverage_kind === "viewshed"
      ? "terrain viewshed"
      : `${props.coverage_radius_km} km radius`;
  return (
    <div className="space-y-1 text-sm">
      <div className="font-semibold">{props.name}</div>
      <div className="text-muted-foreground">
        Elevation: {props.elevation_m} m
      </div>
      <div className="text-muted-foreground">Coverage: {coverage}</div>
      <div className="font-medium">Fires in range: {props.fire_count}</div>
      <TowerRiskPanel towerId={props.id} />
    </div>
  );
}

/** Lazy-loaded fire-risk breakdown for a tower: the latest score/level plus the
 *  contributing FWI-system factors, and a small recent-days trend. Fetched only
 *  when the popup opens. */
function TowerRiskPanel({ towerId }: { towerId: number }) {
  const risk = useAppStore((s) => s.towerRisk[towerId]);
  if (risk && isFailed(risk))
    return (
      <div className="text-muted-foreground mt-2 border-t pt-2 text-xs">
        Couldn&rsquo;t load risk.
      </div>
    );
  const detail = risk ? getLoadedData(risk) : null;
  if (!detail)
    return (
      <div className="text-muted-foreground mt-2 border-t pt-2 text-xs">
        Loading risk…
      </div>
    );

  const latest = detail.series[0];
  if (!latest) {
    return (
      <div className="text-muted-foreground mt-2 border-t pt-2 text-xs">
        No risk computed yet.
      </div>
    );
  }

  const recent = detail.series.slice(0, 7).reverse(); // oldest → newest
  const factors: [string, number][] = [
    ["FFMC", latest.ffmc],
    ["DMC", latest.dmc],
    ["DC", latest.dc],
    ["ISI", latest.isi],
    ["BUI", latest.bui],
    ["FWI", latest.fwi],
  ];

  return (
    <div className="mt-2 border-t pt-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Fire risk</span>
        <span
          className="rounded px-1.5 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: RISK_COLORS[latest.risk_level] }}
        >
          {RISK_LABELS[latest.risk_level]}
        </span>
      </div>
      <div className="text-muted-foreground mt-0.5 text-xs">
        Score {Math.round(latest.risk_score)}/100 · {formatDay(latest.date)}
        {latest.snow_covered ? " · snow-covered" : ""}
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-0.5 text-xs">
        {factors.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-1">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value.toFixed(1)}</span>
          </div>
        ))}
      </div>

      <ModelPrediction prediction={detail.prediction} />

      <div className="mt-2">
        <div className="text-muted-foreground mb-0.5 text-[10px]">
          Last {recent.length} days
        </div>
        <div className="flex items-end gap-0.5" style={{ height: 24 }}>
          {recent.map((d) => (
            <span
              key={d.date}
              title={`${formatDay(d.date)}: ${RISK_LABELS[d.risk_level]} (${Math.round(d.risk_score)})`}
              className="flex-1 rounded-sm"
              style={{
                backgroundColor: RISK_COLORS[d.risk_level],
                height: `${Math.max(10, d.risk_score)}%`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The ML ignition probability beside the FWI rating — "Model: 18% / 3-day".
 *  Framed as a comparison: the deterministic index vs. what the model learned
 *  from history. Null (no trained model yet) shows a quiet placeholder. */
function ModelPrediction({ prediction }: { prediction: PredictionSummary }) {
  const { ignition_probability, horizon_days } = prediction;
  if (ignition_probability === null || horizon_days === null) {
    return (
      <div className="text-muted-foreground mt-1.5 text-[10px]">
        Model: not trained yet
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex items-center justify-between text-xs">
      <span className="text-muted-foreground">Model ignition</span>
      <span className="font-semibold">
        {Math.round(ignition_probability * 100)}% / {horizon_days}-day
      </span>
    </div>
  );
}
