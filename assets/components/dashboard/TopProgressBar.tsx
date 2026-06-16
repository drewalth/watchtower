import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";

/** Slim top loading bar shown while a filtered refetch is in flight — replaces
 *  the old full-screen reloading blur. */
export function TopProgressBar() {
  const active = useAppStore((s) => s.isFiltering);
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="h-full w-1/3 animate-[loading_1s_ease-in-out_infinite] bg-ember" />
    </div>
  );
}
