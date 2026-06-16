import { MapPopup } from "@/components/ui/map";
import { type FireProps } from "@/lib/types";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";

/** The popup for the currently-selected fire detection. Self-selects the
 *  selection + setter so MapView doesn't have to thread them through. */
export function SelectedFirePopup() {
  const { selectedFire, selectFire } = useAppStore(
    useShallow((s) => ({
      selectedFire: s.selectedFire,
      selectFire: s.selectFire,
    })),
  );
  if (!selectedFire) return null;

  return (
    <MapPopup
      longitude={selectedFire.lng}
      latitude={selectedFire.lat}
      onClose={() => selectFire(null)}
      closeButton
      className="rounded-lg border-surface-border bg-surface text-foreground shadow-lg backdrop-blur-md"
    >
      <FirePopup props={selectedFire.props} />
    </MapPopup>
  );
}

function FirePopup({ props }: { props: FireProps }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="font-semibold text-[#d7301f]">Fire detection</div>
      <div className="text-muted-foreground">Source: {props.source}</div>
      <div className="text-muted-foreground">Acquired: {props.acquired_at}</div>
      <div className="text-muted-foreground">
        Confidence: {props.confidence}
      </div>
      <div className="text-muted-foreground">FRP: {props.frp ?? "n/a"} MW</div>
    </div>
  );
}
