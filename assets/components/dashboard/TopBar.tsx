import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/map/ThemeToggle";
import { HelpModal } from "@/components/HelpModal";
import { GlassPanel } from "./GlassPanel";
import { Brand } from "./Brand";
import { PresetBar } from "./PresetBar";
import { FreshnessPill } from "./FreshnessPill";

export function TopBar() {
  const [help, setHelp] = useState(false);
  return (
    <header className="z-20 border-b border-surface-border">
      <GlassPanel className="flex h-12 items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-3">
        <Brand />
        <div className="flex items-center gap-2">
          <PresetBar />
          <FreshnessPill />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Help"
            onClick={() => setHelp(true)}
          >
            <HelpCircle className="size-4" />
          </Button>
        </div>
      </GlassPanel>
      <HelpModal open={help} onOpenChange={setHelp} />
    </header>
  );
}
