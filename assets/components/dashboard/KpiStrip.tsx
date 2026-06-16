import { useKpis } from "./useKpis";
import { StatTile } from "./StatTile";
import { RiskDistributionBar } from "./RiskDistributionBar";

const dash = (v: number | null) => (v == null ? "—" : v);

export function KpiStrip() {
  const k = useKpis();
  return (
    <div className="flex gap-2 overflow-x-auto px-3 py-2">
      <StatTile
        label="Active fires"
        value={k.activeFires}
        sparkline={k.activeFiresSparkline}
        sublabel="in selected window"
      />
      <StatTile
        label="Towers in range"
        value={k.towersInRange}
        unit={`/ ${k.towersTotal}`}
        sublabel="with detections"
      />
      <StatTile
        label="Elevated risk"
        value={k.elevatedRisk}
        sublabel="high+ towers"
      >
        <RiskDistributionBar
          distribution={k.riskDistribution}
          className="mt-1.5"
        />
      </StatTile>
      <StatTile
        label="Peak FRP"
        value={dash(k.peakFrpMw)}
        unit="MW"
        sublabel="max intensity"
      />
      <StatTile
        label="Mean ML ignition"
        value={dash(k.meanIgnitionPct)}
        unit={k.meanIgnitionPct == null ? undefined : "%"}
        sublabel="latest model"
      />
    </div>
  );
}
