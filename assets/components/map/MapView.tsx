import { useMemo } from "react";

import { Map } from "@/components/ui/map";

import { AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import { TimeRangeControl } from "@/components/analytics/TimeRangeControl";
import { CoverageLayer } from "@/components/map/CoverageLayer";
import { FilterSearchControl } from "@/components/map/FilterSearchControl";
import { FireClusterLayer } from "@/components/map/FireClusterLayer";
import { MapControls } from "@/components/map/MapControls";
import { MapLegend } from "@/components/map/MapLegend";
import { ReloadingOverlay } from "@/components/map/ReloadingOverlay";
import { MapReadyReporter } from "@/components/map/MapReadyReporter";
import { MapViewportSync } from "@/components/map/MapViewportSync";
import { SelectedFirePopup } from "@/components/map/SelectedFirePopup";
import { TowerMarkers } from "@/components/map/TowerMarkers";
import { useMapStyle } from "@/components/map/useMapStyle";
import { SATELLITE_STYLE } from "@/lib/basemap";
import { getLoadedData } from "@/lib/loadable";
import { denseDailyTotals } from "@/lib/time";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";

// California-ish starting view; fitBounds refines it once towers load.
const CA_CENTER: [number, number] = [-120.5, 38.5];

// Stable identity so the Map's style effect doesn't re-run every render.
const MAP_STYLES = { satellite: SATELLITE_STYLE };

export function MapView() {
  // Map layers self-select from the store; MapView only needs the values that
  // feed the (prop-driven) analytics panel + time-range control, grouped into a
  // single shallow-compared subscription so unrelated state changes (fire
  // selection, tower risk) don't re-render the shell.
  const { timeseries, risk, stats, timeWindow, preset, setWindow, setPreset } =
    useAppStore(
      useShallow((s) => ({
        timeseries: getLoadedData(s.timeseries),
        risk: getLoadedData(s.risk),
        stats: getLoadedData(s.stats),
        timeWindow: s.timeWindow,
        preset: s.preset,
        setWindow: s.setWindow,
        setPreset: s.setPreset,
      })),
    );

  const [styleId, setStyleId] = useMapStyle();

  const minDate = timeseries?.min_date ?? null;
  const maxDate = timeseries?.max_date ?? null;

  const dense = useMemo(
    () =>
      timeseries && minDate && maxDate
        ? denseDailyTotals(timeseries.series, minDate, maxDate)
        : [],
    [timeseries, minDate, maxDate],
  );

  return (
    <Map
      center={CA_CENTER}
      zoom={6}
      styleId={styleId}
      styles={MAP_STYLES}
      className="h-full w-full"
    >
      <MapReadyReporter />
      <MapViewportSync styleId={styleId} />
      <MapControls styleId={styleId} onStyleChange={setStyleId} />
      <MapLegend />
      <CoverageLayer />
      <TowerMarkers />
      <FireClusterLayer />
      <FilterSearchControl />
      <ReloadingOverlay />
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
            onWindowChange={setWindow}
            onPresetChange={setPreset}
          />
        </>
      )}
      <SelectedFirePopup />
    </Map>
  );
}
