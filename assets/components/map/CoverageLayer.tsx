import { useEffect } from "react";

import { useMap } from "@/components/ui/map";
import { getLoadedData } from "@/lib/loadable";
import { CIRCLE, VIEWSHED } from "@/lib/mapStyle";
import { type TowerCollection } from "@/lib/types";
import { useAppStore } from "@/store/appStore";

// MapLibre source/layer ids.
const COVERAGE_SOURCE = "coverage";
const COVERAGE_FILL = "coverage-fill";
const COVERAGE_LINE = "coverage-line";

/** Tower coverage polygons as a fill + outline layer, coloured by kind. */
export function CoverageLayer() {
  const towers = useAppStore((s) => getLoadedData(s.towers));
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!isLoaded || !map || !towers) return;

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
        "fill-opacity": [
          "match",
          ["get", "kind"],
          "viewshed",
          0.18,
          0.08,
        ] as never,
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
