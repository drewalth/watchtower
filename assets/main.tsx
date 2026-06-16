import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/globals.css";
import { App } from "./App";
import { initDateLocale } from "./lib/datetime";
import { useAppStore } from "./store/appStore";

// Kick off data loading once, at module scope — runs a single time per app load
// (unlike a useEffect, which would double-fire under StrictMode and re-run on
// remount). See react.dev/learn/you-might-not-need-an-effect#initializing-the-application.
useAppStore.getState().initialize();

const container = document.getElementById("root");
function mount() {
  if (container) {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
}

// Load the viewer's date locale before first paint so dates render localized from
// the start (no en→locale flash). Capped so a slow/blocked locale chunk can never
// hold up the app; on timeout we mount with English and the locale stays English
// for the session (formatters already fall back to en). initDateLocale itself
// never rejects — the race guards only against a hung dynamic import.
const LOCALE_LOAD_TIMEOUT_MS = 1500;
const localeReady = Promise.race([
  initDateLocale(),
  new Promise<void>((resolve) => setTimeout(resolve, LOCALE_LOAD_TIMEOUT_MS)),
]);
void localeReady.finally(mount);
