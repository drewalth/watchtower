import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CIRCLE,
  RISK_COLORS,
  RISK_LABELS,
  RISK_LEVELS,
  VIEWSHED,
} from "@/lib/mapStyle";
import type { RiskLevel } from "@/lib/types";

// Static body content — hoisted out of render since it never changes.

function RiskSwatch({ level }: { level: RiskLevel }) {
  return (
    <span
      className="inline-block size-3 rounded-full border border-white/60 align-middle"
      style={{ backgroundColor: RISK_COLORS[level] }}
      title={RISK_LABELS[level]}
    />
  );
}

function CoverageSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-3 rounded-[2px] border-2 align-middle"
      style={{ borderColor: color, backgroundColor: `${color}33` }}
    />
  );
}

const SECTION_CLASS = "space-y-1.5";
const HEADING_CLASS = "font-semibold text-sm";
const TERM_CLASS = "font-semibold";

const BODY_CONTENT = (
  <div className="space-y-5 text-sm">
    {/* 1. Map symbols */}
    <section className={SECTION_CLASS}>
      <h3 className={HEADING_CLASS}>Map symbols</h3>
      <ul className="space-y-1.5 text-muted-foreground">
        <li className="flex gap-2">
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-600 shadow" />
          <span>
            <span className={TERM_CLASS}>Fire-lookout marker</span> — a tower icon colored by the
            tower&apos;s current fire-risk level (see the Fire risk section below for the color
            scale).
          </span>
        </li>
        <li className="flex gap-2">
          <CoverageSwatch color={VIEWSHED} />
          <span>
            <span className={TERM_CLASS}>Terrain viewshed</span> (green) — the real line-of-sight
            polygon computed from elevation data (Copernicus GLO-30 DEM). Shows exactly which ground
            the lookout can see given the surrounding terrain.
          </span>
        </li>
        <li className="flex gap-2">
          <CoverageSwatch color={CIRCLE} />
          <span>
            <span className={TERM_CLASS}>Coverage radius</span> (blue) — a naive 50 km circle
            shown when no viewshed has been computed yet for a tower.
          </span>
        </li>
        <li className="flex gap-2">
          <span
            className="mt-0.5 size-3 shrink-0 rounded-full"
            style={{ backgroundColor: "#ef6548", border: "1px solid #d7301f" }}
          />
          <span>
            <span className={TERM_CLASS}>Active fire</span> — an orange point for each satellite
            detection; individual points cluster into counts when zoomed out so the map stays
            responsive.
          </span>
        </li>
      </ul>
    </section>

    {/* 2. Fire detections */}
    <section className={SECTION_CLASS}>
      <h3 className={HEADING_CLASS}>Fire detections (FIRMS / VIIRS)</h3>
      <ul className="space-y-1 text-muted-foreground">
        <li>
          <span className={TERM_CLASS}>FIRMS</span> — NASA Fire Information for Resource Management
          System. The live satellite data feed powering this map.
        </li>
        <li>
          <span className={TERM_CLASS}>VIIRS</span> — Visible Infrared Imaging Radiometer Suite.
          The satellite sensor that detects active fire signatures from orbit.
        </li>
        <li>
          <span className={TERM_CLASS}>NOAA-20 / SNPP / NOAA-21</span> — the three polar-orbiting
          satellites carrying VIIRS instruments. All three are ingested so coverage gaps on one
          satellite don&apos;t drop detections.
        </li>
        <li>
          <span className={TERM_CLASS}>NRT</span> — Near-Real-Time. Data available within hours of
          acquisition, used during active fire events.
        </li>
        <li>
        <span className={TERM_CLASS}>SP</span> —
        Standard Processing (the quality-controlled archive feed), used for historical queries.
        </li>
        <li>
          <span className={TERM_CLASS}>FRP</span> — Fire Radiative Power, measured in megawatts
          (MW). A proxy for fire intensity: higher FRP means more energy is being released.
        </li>
        <li>
          <span className={TERM_CLASS}>Confidence</span> — the sensor&apos;s per-detection
          confidence rating (low / nominal / high). Lower confidence detections may be smoldering
          or obscured by cloud cover.
        </li>
      </ul>
    </section>

    {/* 3. Fire risk / FWI */}
    <section className={SECTION_CLASS}>
      <h3 className={HEADING_CLASS}>Fire risk (Canadian FWI System)</h3>
      <p className="text-muted-foreground">
        Each tower is rated daily from <span className={TERM_CLASS}>Low</span> to{" "}
        <span className={TERM_CLASS}>Extreme</span>, also expressed as a 0–100 score. The six
        underlying moisture and behavior codes are:
      </p>
      <div className="my-1.5 flex items-center gap-1">
        {RISK_LEVELS.map((level) => (
          <RiskSwatch key={level} level={level} />
        ))}
        <span className="ml-1 text-xs text-muted-foreground">Low → Extreme</span>
      </div>
      <ul className="space-y-1 text-muted-foreground">
        <li>
          <span className={TERM_CLASS}>FFMC</span> — Fine Fuel Moisture Code. Tracks dryness of
          surface litter and fine dead fuels; high values mean easy ignition from a spark.
        </li>
        <li>
          <span className={TERM_CLASS}>DMC</span> — Duff Moisture Code. Reflects moisture in
          loosely compacted organic layers a few centimetres deep.
        </li>
        <li>
          <span className={TERM_CLASS}>DC</span> — Drought Code. Captures long-term deep-soil
          dryness; slow to rise and fall, it drives late-season fire behavior.
        </li>
        <li>
          <span className={TERM_CLASS}>ISI</span> — Initial Spread Index. Combines wind speed and
          FFMC to estimate how fast a fire would spread after ignition.
        </li>
        <li>
          <span className={TERM_CLASS}>BUI</span> — Buildup Index. Combines DMC and DC into a
          single measure of total fuel available for combustion.
        </li>
        <li>
          <span className={TERM_CLASS}>FWI</span> — Fire Weather Index. The headline number,
          combining ISI and BUI into an overall rating of potential fire intensity and difficulty of
          control.
        </li>
      </ul>
    </section>

    {/* 4. ML ignition */}
    <section className={SECTION_CLASS}>
      <h3 className={HEADING_CLASS}>Model ignition probability</h3>
      <p className="text-muted-foreground">
        Shown alongside the FWI rating in each tower&apos;s popup (e.g. &ldquo;18% / 3-day&rdquo;).
        This is a machine-learning estimate of the probability that a fire starts near the tower
        within the stated horizon window, trained on historical weather and fire-detection data.
        It provides a data-driven complement to the deterministic FWI rating. The label reads{" "}
        <em>not trained yet</em> until a model artifact has been built with{" "}
        <code className="rounded bg-muted px-1 text-xs">train_fire_model</code>.
      </p>
    </section>

    {/* 5. Time range */}
    <section className={SECTION_CLASS}>
      <h3 className={HEADING_CLASS}>Time range control</h3>
      <p className="text-muted-foreground">
        The histogram and preset buttons at the bottom of the screen set a time window that scopes
        both the fires drawn on the map and the analytics cards in the side panel. The window is
        anchored to the <span className={TERM_CLASS}>latest available detection date</span> in the
        database — not today&apos;s wall-clock date — so the view is meaningful even when the live
        feed has a delay or the data is historical.
      </p>
    </section>
  </div>
);

export function HelpModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Map guide</DialogTitle>
          <DialogDescription>
            What the symbols, codes, and controls on this map mean.
          </DialogDescription>
        </DialogHeader>
        {BODY_CONTENT}
      </DialogContent>
    </Dialog>
  );
}
