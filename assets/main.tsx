import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/globals.css";
import { App } from "./App";
import { useAppStore } from "./store/appStore";

// Kick off data loading once, at module scope — runs a single time per app load
// (unlike a useEffect, which would double-fire under StrictMode and re-run on
// remount). See react.dev/learn/you-might-not-need-an-effect#initializing-the-application.
useAppStore.getState().initialize();

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
