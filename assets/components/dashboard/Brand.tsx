import { Flame } from "lucide-react";

export function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-md bg-brand/15 text-brand">
        <Flame className="size-4" />
      </span>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">WATCHTOWER</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-muted-foreground">
          wildfire lookout intel
        </div>
      </div>
    </div>
  );
}
