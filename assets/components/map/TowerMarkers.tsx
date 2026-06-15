import { TowerControl } from "lucide-react";

import { MapMarker, MarkerContent, MarkerPopup } from "@/components/ui/map";
import { useFilteredTowers } from "@/hooks/useFilteredMapData";
import { getLoadedData, isFailed } from "@/lib/loadable";
import { RISK_COLORS, RISK_LABELS, riskColor } from "@/lib/mapStyle";
import { type PredictionSummary, type TowerProps } from "@/lib/types";
import { useAppStore } from "@/store/appStore";

/** One clickable marker per tower (filtered to the active search/filters), with
 *  a popup of its details. */
export function TowerMarkers() {
  const { visibleTowerCollection } = useFilteredTowers();
  const loadTowerRisk = useAppStore((s) => s.loadTowerRisk);
  if (!visibleTowerCollection) return null;
  return (
    <>
      {visibleTowerCollection.features.map((f) => {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        return (
          <MapMarker key={f.properties.id} longitude={lng} latitude={lat}>
            <MarkerContent>
              {/* The same click that opens the popup kicks off the lazy risk
                  fetch — an event handler, not a mount effect. */}
              <div
                onClick={() => loadTowerRisk(f.properties.id)}
                className="flex size-7 items-center justify-center rounded-full border-2 border-white text-white shadow-md"
                style={{ backgroundColor: riskColor(f.properties.risk_level) }}
              >
                <TowerControl className="size-4" />
              </div>
            </MarkerContent>
            <MarkerPopup closeButton>
              <TowerPopup props={f.properties} />
            </MarkerPopup>
          </MapMarker>
        );
      })}
    </>
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
        Score {Math.round(latest.risk_score)}/100 · {latest.date}
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
              title={`${d.date}: ${RISK_LABELS[d.risk_level]} (${Math.round(d.risk_score)})`}
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
