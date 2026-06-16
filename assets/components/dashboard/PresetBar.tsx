import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import { PRESETS } from "@/lib/time";
import { cn } from "@/lib/utils";

export function PresetBar() {
  const { preset, setPreset } = useAppStore(
    useShallow((s) => ({ preset: s.preset, setPreset: s.setPreset })),
  );
  return (
    <div className="hidden items-center gap-0.5 rounded-md border border-surface-border bg-muted/40 p-0.5 sm:flex">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          onClick={() => setPreset(p.key)}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            preset === p.key
              ? "bg-ember text-ember-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
