import { MapView } from "@/components/map/MapView";
import { TopBar } from "./TopBar";
import { KpiStrip } from "./KpiStrip";
import { AnalyticsDock } from "./AnalyticsDock";
import { TimelineDock } from "./TimelineDock";
import { TopProgressBar } from "./TopProgressBar";

/** Command-center layout: header, KPI strip, map+dock body, timeline. The map is
 *  the hero in the body's flex-1 cell; the analytics dock sits to its right. */
export function DashboardShell() {
  return (
    <div className="relative grid h-screen w-screen grid-rows-[auto_auto_1fr_auto] overflow-hidden bg-background text-foreground">
      <TopProgressBar />
      <TopBar />
      <KpiStrip />
      <div className="relative flex min-h-0 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          <MapView />
        </div>
        <AnalyticsDock />
      </div>
      <TimelineDock />
    </div>
  );
}
