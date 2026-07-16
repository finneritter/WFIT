// Entry for the relic-crack HUD overlay window. Deliberately lightweight — no
// React Query, no app shell, no router. It renders one HUD box from a payload
// the Rust side pushes on each capture.
import React from "react";
import ReactDOM from "react-dom/client";
import { RelicOverlay } from "./RelicOverlay";
import "./relic-overlay.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RelicOverlay />
  </React.StrictMode>,
);
