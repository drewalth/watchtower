import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/** Translucent, blurred surface used for all dashboard chrome. */
export function GlassPanel({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "rounded-xl border border-surface-border bg-surface shadow-lg backdrop-blur-md",
        className,
      )}
      {...props}
    />
  );
}
