import { useEffect, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "./GlassPanel";
import { OverviewTab } from "./OverviewTab";
import { TowersTab } from "./TowersTab";
import { RiskTab } from "./RiskTab";

const KEY = "watchtower:dock";

/** Collapsible, tabbed analytics dock. A flex sibling of the map; collapsing
 *  drops it from flow (the map reclaims the width) and leaves a reopen button. */
export function AnalyticsDock() {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        setOpen(s.open ?? true);
        setTab(s.tab ?? "overview");
      } catch {
        // Corrupt value — ignore and keep defaults.
      }
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify({ open, tab }));
  }, [open, tab]);

  // Below lg the open dock overlays the map; let Escape dismiss it so the map
  // controls underneath stay reachable.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open analytics"
        onClick={() => setOpen(true)}
        className="absolute right-2 top-2 z-10 border border-surface-border bg-surface backdrop-blur-md"
      >
        <PanelRightOpen className="size-4" />
      </Button>
    );
  }
  return (
    <>
      {/* sub-lg scrim: dims the map and dismisses the dock on an outside click so
          the map controls underneath stay reachable. Hidden at lg+ where the dock
          is a static sibling that covers nothing. */}
      <div
        className="absolute inset-0 z-10 bg-black/20 lg:hidden"
        aria-hidden
        onClick={() => setOpen(false)}
      />
      <GlassPanel className="absolute inset-y-2 right-2 z-20 flex w-[340px] max-w-[92vw] flex-col rounded-xl lg:static lg:inset-auto lg:z-10 lg:m-2 lg:ml-0">
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex items-center justify-between gap-2 border-b border-surface-border p-2">
            <TabsList className="bg-muted/40">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="towers">Towers</TabsTrigger>
              <TabsTrigger value="risk">Risk</TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse analytics"
              onClick={() => setOpen(false)}
            >
              <PanelRightClose className="size-4" />
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-2">
              <TabsContent value="overview" className="mt-0">
                <OverviewTab />
              </TabsContent>
              <TabsContent value="towers" className="mt-0">
                <TowersTab />
              </TabsContent>
              <TabsContent value="risk" className="mt-0">
                <RiskTab />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </GlassPanel>
    </>
  );
}
