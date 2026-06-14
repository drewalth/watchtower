import { useCallback, useEffect, useState } from "react";
import type { MapLayerMouseEvent } from "maplibre-gl";

import {
  Map,
  MapControls,
  MapMarker,
  MapPopup,
  MarkerContent,
  MarkerPopup,
  useMap,
} from "@/components/ui/map";
import { TowerControl } from "lucide-react";

import {
  API,
  type FireCollection,
  type FireProps,
  type TowerCollection,
  type TowerProps,
} from "@/lib/types";

// MapLibre source/layer ids.
const COVERAGE_SOURCE = "coverage";
const COVERAGE_FILL = "coverage-fill";
const COVERAGE_LINE = "coverage-line";
const FIRE_SOURCE = "fires";
const FIRE_CIRCLE = "fire-circle";

// Coverage colours: viewshed green, circle blue.
const VIEWSHED = "#238b45";
const CIRCLE = "#2b8cbe";

// California-ish starting view; fitBounds refines it once towers load.
const CA_CENTER: [number, number] = [-120.5, 38.5];

type SelectedFire = { lng: number; lat: number; props: FireProps };

/** Fetch a GeoJSON FeatureCollection once and keep it in state. */
function useGeoJson<T>(url: string): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let active = true;
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (active) setData(json as T);
      })
      .catch((err) => console.error(`Failed to load ${url}`, err));
    return () => {
      active = false;
    };
  }, [url]);
  return data;
}

export function MapView() {
  const towers = useGeoJson<TowerCollection>(API.towers);
  const fires = useGeoJson<FireCollection>(API.fires);
  const [selectedFire, setSelectedFire] = useState<SelectedFire | null>(null);

  return (
    <Map center={CA_CENTER} zoom={6} className="h-full w-full">
      <MapControls showZoom showFullscreen />
      <MapLegend towers={towers} />
      {towers && <CoverageLayer towers={towers} />}
      {towers && <TowerMarkers towers={towers} />}
      {fires && <FiresLayer fires={fires} onSelect={setSelectedFire} />}
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

/** Live fire detections as red circles; clicking one opens a popup. */
function FiresLayer({
  fires,
  onSelect,
}: {
  fires: FireCollection;
  onSelect: (fire: SelectedFire) => void;
}) {
  const { map, isLoaded } = useMap();
  const handleSelect = useCallback(onSelect, [onSelect]);

  useEffect(() => {
    if (!isLoaded || !map) return;

    map.addSource(FIRE_SOURCE, { type: "geojson", data: fires });
    map.addLayer({
      id: FIRE_CIRCLE,
      type: "circle",
      source: FIRE_SOURCE,
      paint: {
        "circle-radius": 4,
        "circle-color": "#ef6548",
        "circle-stroke-color": "#d7301f",
        "circle-stroke-width": 1,
        "circle-opacity": 0.85,
      },
    });

    const onClick = (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates as [
        number,
        number,
      ];
      handleSelect({ lng, lat, props: feature.properties as unknown as FireProps });
    };
    const enter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", FIRE_CIRCLE, onClick);
    map.on("mouseenter", FIRE_CIRCLE, enter);
    map.on("mouseleave", FIRE_CIRCLE, leave);

    return () => {
      map.off("click", FIRE_CIRCLE, onClick);
      map.off("mouseenter", FIRE_CIRCLE, enter);
      map.off("mouseleave", FIRE_CIRCLE, leave);
      if (map.getLayer(FIRE_CIRCLE)) map.removeLayer(FIRE_CIRCLE);
      if (map.getSource(FIRE_SOURCE)) map.removeSource(FIRE_SOURCE);
    };
  }, [isLoaded, map, fires, handleSelect]);

  return null;
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
              <div className="flex size-7 items-center justify-center rounded-full border-2 border-white bg-slate-800 text-white shadow-md">
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
