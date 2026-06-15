import { useEffect, useMemo, useState } from "react";

import {
  Map,
  MapClusterLayer,
  MapControls,
  MapMarker,
  MapPopup,
  MarkerContent,
  MarkerPopup,
  useMap,
} from "@/components/ui/map";
import { TowerControl } from "lucide-react";

import { AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import { TimeRangeControl } from "@/components/analytics/TimeRangeControl";
import { useJson } from "@/lib/useJson";
import {
  denseDailyTotals,
  presetWindow,
  type PresetKey,
  type TimeWindow,
} from "@/lib/time";
import {
  API,
  firesQuery,
  statsQuery,
  type FireCollection,
  type FireProps,
  type FireStats,
  type FireTimeseries,
  type PredictionSummary,
  type RiskLevel,
  type RiskTimeseries,
  type TowerCollection,
  type TowerProps,
  type TowerRiskDetail,
} from "@/lib/types";

// MapLibre source/layer ids.
const COVERAGE_SOURCE = "coverage";
const COVERAGE_FILL = "coverage-fill";
const COVERAGE_LINE = "coverage-line";
// Coverage colours: viewshed green, circle blue.
const VIEWSHED = "#238b45";
const CIRCLE = "#2b8cbe";

// Fire-risk ramp, low → extreme. Ordered for the legend scale.
const RISK_LEVELS: RiskLevel[] = ["low", "moderate", "high", "very_high", "extreme"];
const RISK_COLORS: Record<RiskLevel, string> = {
  low: "#2b9348",
  moderate: "#f9c74f",
  high: "#f3722c",
  very_high: "#e63946",
  extreme: "#9d0208",
};
const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
  extreme: "Extreme",
};
// No assessment yet (compute_fire_risk hasn't run): neutral slate marker.
const RISK_UNKNOWN = "#475569";

function riskColor(level: RiskLevel | null): string {
  return level ? RISK_COLORS[level] : RISK_UNKNOWN;
}

// California-ish starting view; fitBounds refines it once towers load.
const CA_CENTER: [number, number] = [-120.5, 38.5];

type SelectedFire = { lng: number; lat: number; props: FireProps };

// Initial time window: the last 30 days of available data.
const DEFAULT_PRESET: PresetKey = "30d";

export function MapView() {
  const towers = useJson<TowerCollection>(API.towers);
  const timeseries = useJson<FireTimeseries>(API.firesTimeseries);
  const risk = useJson<RiskTimeseries>(API.riskTimeseries);

  const [timeWindow, setTimeWindow] = useState<TimeWindow | null>(null);
  const [preset, setPreset] = useState<PresetKey | null>(DEFAULT_PRESET);
  const [selectedFire, setSelectedFire] = useState<SelectedFire | null>(null);

  // Anchor the initial window to the latest detection (not wall-clock now) once
  // the timeseries — and with it the data's date range — has loaded.
  const minDate = timeseries?.min_date ?? null;
  const maxDate = timeseries?.max_date ?? null;
  useEffect(() => {
    if (minDate && maxDate && !timeWindow) {
      setTimeWindow(presetWindow(DEFAULT_PRESET, minDate, maxDate));
    }
  }, [minDate, maxDate, timeWindow]);

  // Window-scoped fetches re-run whenever the window (and thus the URL) changes.
  const fires = useJson<FireCollection>(
    timeWindow ? firesQuery(timeWindow) : null,
  );
  const stats = useJson<FireStats>(timeWindow ? statsQuery(timeWindow) : null);

  const dense = useMemo(
    () =>
      timeseries && minDate && maxDate
        ? denseDailyTotals(timeseries.series, minDate, maxDate)
        : [],
    [timeseries, minDate, maxDate],
  );

  const handlePreset = (key: PresetKey) => {
    if (!minDate || !maxDate) return;
    setPreset(key);
    setTimeWindow(presetWindow(key, minDate, maxDate));
  };
  const handleWindow = (next: TimeWindow) => {
    setPreset(null); // a manual brush is no longer one of the presets
    setTimeWindow(next);
  };

  return (
    <Map center={CA_CENTER} zoom={6} className="h-full w-full">
      <MapControls showZoom showFullscreen />
      <MapLegend towers={towers} />
      {towers && <CoverageLayer towers={towers} />}
      {towers && <TowerMarkers towers={towers} />}
      {fires && <FireClusterLayer fires={fires} onSelect={setSelectedFire} />}
      {timeseries && timeWindow && (
        <>
          <AnalyticsPanel
            timeseries={timeseries}
            risk={risk}
            stats={stats}
            window={timeWindow}
          />
          <TimeRangeControl
            dense={dense}
            window={timeWindow}
            preset={preset}
            onWindowChange={handleWindow}
            onPresetChange={handlePreset}
          />
        </>
      )}
      {selectedFire && (
        <MapPopup
          longitude={selectedFire.lng}
          latitude={selectedFire.lat}
          onClose={() => setSelectedFire(null)}
          closeButton
        >
          <FirePopup props={selectedFire.props} />
        </MapPopup>
      )}
    </Map>
  );
}

/** A small overlay key for the map's symbols. Coverage rows show only for the
 *  kinds actually present in the data, so the legend matches what's drawn. */
function MapLegend({ towers }: { towers: TowerCollection | null }) {
  const kinds = new Set(towers?.features.map((f) => f.properties.coverage_kind));
  return (
    <div className="bg-background/95 text-foreground absolute top-2 left-2 z-10 rounded-md border p-3 text-xs shadow-sm backdrop-blur-sm">
      <div className="mb-1.5 font-semibold">Legend</div>
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2">
          <span className="flex size-4 items-center justify-center rounded-full border-2 border-white bg-slate-800 text-white shadow">
            <TowerControl className="size-2.5" />
          </span>
          Fire lookout
        </li>
        {kinds.has("viewshed") && (
          <li className="flex items-center gap-2">
            <Swatch color={VIEWSHED} />
            Terrain viewshed
          </li>
        )}
        {kinds.has("circle") && (
          <li className="flex items-center gap-2">
            <Swatch color={CIRCLE} />
            Coverage radius
          </li>
        )}
        <li className="flex items-center gap-2">
          <span
            className="size-3 rounded-full"
            style={{ backgroundColor: "#ef6548", border: "1px solid #d7301f" }}
          />
          Active fire
        </li>
      </ul>
      <div className="mt-2 border-t pt-2">
        <div className="mb-1.5 font-semibold">Fire risk</div>
        <div className="flex items-center gap-1">
          {RISK_LEVELS.map((level) => (
            <span
              key={level}
              title={RISK_LABELS[level]}
              className="size-3 rounded-full border border-white/60"
              style={{ backgroundColor: RISK_COLORS[level] }}
            />
          ))}
        </div>
        <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
          <span>Low</span>
          <span>Extreme</span>
        </div>
      </div>
    </div>
  );
}

/** Filled, translucent square outlined in `color` — mirrors a coverage polygon. */
function Swatch({ color }: { color: string }) {
  return (
    <span
      className="size-3 rounded-[2px] border-2"
      style={{ borderColor: color, backgroundColor: `${color}33` }}
    />
  );
}

/** Tower coverage polygons as a fill + outline layer, coloured by kind. */
function CoverageLayer({ towers }: { towers: TowerCollection }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!isLoaded || !map) return;

    const features = towers.features
      .filter((f) => f.properties.coverage)
      .map((f) => ({
        type: "Feature" as const,
        geometry: f.properties.coverage as GeoJSON.Geometry,
        properties: { kind: f.properties.coverage_kind },
      }));
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    };
    const byKind = ["match", ["get", "kind"], "viewshed", VIEWSHED, CIRCLE];

    map.addSource(COVERAGE_SOURCE, { type: "geojson", data });
    map.addLayer({
      id: COVERAGE_FILL,
      type: "fill",
      source: COVERAGE_SOURCE,
      paint: {
        "fill-color": byKind as never,
        "fill-opacity": ["match", ["get", "kind"], "viewshed", 0.18, 0.08] as never,
      },
    });
    map.addLayer({
      id: COVERAGE_LINE,
      type: "line",
      source: COVERAGE_SOURCE,
      paint: { "line-color": byKind as never, "line-width": 1 },
    });

    fitToCoverage(map, features, towers);

    return () => {
      if (map.getLayer(COVERAGE_LINE)) map.removeLayer(COVERAGE_LINE);
      if (map.getLayer(COVERAGE_FILL)) map.removeLayer(COVERAGE_FILL);
      if (map.getSource(COVERAGE_SOURCE)) map.removeSource(COVERAGE_SOURCE);
    };
  }, [isLoaded, map, towers]);

  return null;
}

/** Fire detections as a clustered layer: counts at low zoom, individual points
 *  up close (clicking one opens its popup). Clustering keeps the map responsive
 *  even when a wide window spans tens of thousands of detections. */
function FireClusterLayer({
  fires,
  onSelect,
}: {
  fires: FireCollection;
  onSelect: (fire: SelectedFire) => void;
}) {
  return (
    <MapClusterLayer<FireProps>
      data={fires}
      pointColor="#ef6548"
      clusterColors={["#fdbb84", "#ef6548", "#d7301f"]}
      onPointClick={(feature, coordinates) => {
        if (!feature.properties) return;
        onSelect({
          lng: coordinates[0],
          lat: coordinates[1],
          props: feature.properties,
        });
      }}
    />
  );
}

/** One clickable marker per tower, with a popup of its details. */
function TowerMarkers({ towers }: { towers: TowerCollection }) {
  return (
    <>
      {towers.features.map((f) => {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        return (
          <MapMarker key={f.properties.id} longitude={lng} latitude={lat}>
            <MarkerContent>
              <div
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
      <div className="text-muted-foreground">Elevation: {props.elevation_m} m</div>
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
  const detail = useJson<TowerRiskDetail>(API.towerRisk(towerId));
  if (!detail) return <div className="text-muted-foreground mt-2 border-t pt-2 text-xs">Loading risk…</div>;

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
        <div className="text-muted-foreground mb-0.5 text-[10px]">Last {recent.length} days</div>
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

function FirePopup({ props }: { props: FireProps }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="font-semibold text-[#d7301f]">Fire detection</div>
      <div className="text-muted-foreground">Source: {props.source}</div>
      <div className="text-muted-foreground">Acquired: {props.acquired_at}</div>
      <div className="text-muted-foreground">Confidence: {props.confidence}</div>
      <div className="text-muted-foreground">FRP: {props.frp ?? "n/a"} MW</div>
    </div>
  );
}

/** Fit the viewport to all coverage polygons (or tower points if none). */
function fitToCoverage(
  map: NonNullable<ReturnType<typeof useMap>["map"]>,
  features: { geometry: GeoJSON.Geometry }[],
  towers: TowerCollection,
) {
  const coords: [number, number][] = [];
  const push = (g: GeoJSON.Geometry) => {
    if (g.type === "Polygon") {
      g.coordinates.forEach((ring) =>
        ring.forEach((c) => coords.push(c as [number, number])),
      );
    } else if (g.type === "MultiPolygon") {
      g.coordinates.forEach((poly) =>
        poly.forEach((ring) =>
          ring.forEach((c) => coords.push(c as [number, number])),
        ),
      );
    }
  };
  features.forEach((f) => push(f.geometry));
  if (coords.length === 0) {
    towers.features.forEach((t) =>
      coords.push(t.geometry.coordinates as [number, number]),
    );
  }
  if (coords.length === 0) return;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    { padding: 60, duration: 0 },
  );
}
