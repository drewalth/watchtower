import { Spinner } from "@/components/ui/spinner";
import { useAppStore } from "@/store/appStore";

/** Full-screen passive reloading indicator shown while the debounced tower
 *  search is settling. Sits above the map + its controls (z-40) but below
 *  modals (z-50); `pointer-events-none` so it never blocks interaction. */
export function ReloadingOverlay() {
  const isFiltering = useAppStore((s) => s.isFiltering);
  if (!isFiltering) return null;
  return (
    <div className="bg-background/30 pointer-events-none absolute inset-0 z-40 flex items-center justify-center backdrop-blur-[1px]">
      <Spinner className="text-muted-foreground size-8" />
    </div>
  );
}
