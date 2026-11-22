import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { applyRawPayloads, applyTheme, followSystemTheme, loadRawPayloads, loadTheme } from "./theme.js";
import "./styles.css";

// Before first paint, so a chosen theme does not flash the other one.
applyTheme(loadTheme());
applyRawPayloads(loadRawPayloads());
followSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
