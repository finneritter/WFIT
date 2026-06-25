// Entry for the Cascade HUD overlay window. Deliberately lightweight — no React
// Query, no app shell, no router. It renders a single pill from a payload the
// Rust side pushes on each hotkey press.
import React from "react";
import ReactDOM from "react-dom/client";
import { Overlay } from "./Overlay";
import "./overlay.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>,
);
