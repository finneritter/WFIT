import { listen } from "@tauri-apps/api/event";
// The Cascade HUD pill. Rust pushes a `CascadeStatus` on every hotkey press
// (event "overlay-show"); we also fetch once on mount as a fallback in case the
// webview is shown before the first event lands. The pill is tinted by the
// active cascade's relic tier and shows a live-ticking countdown.
//
// Auto-hide is Rust-owned (see src-tauri/src/overlay.rs) — the frontend never
// hides itself, so a throttled webview timer can't strand the window.
import { useEffect, useState } from "react";
import { Countdown } from "../components/Countdown";
import { getCascadeStatus } from "../lib/api";
import type { CascadeStatus } from "../lib/types";

export function Overlay() {
  const [status, setStatus] = useState<CascadeStatus | null>(null);

  useEffect(() => {
    // Fallback: if the window is shown before the first push event, fetch now.
    getCascadeStatus()
      .then(setStatus)
      .catch(() => {});
    const un = listen<CascadeStatus>("overlay-show", (e) => setStatus(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const tier = status?.active ? status.tier : null;
  const tierClass = tier ? `t-${tier.toLowerCase()}` : "t-none";

  return (
    <div className={`ov ${status?.active ? "ov-hit" : "ov-miss"} ${tierClass}`}>
      <div className="ov-led" />
      <div className="ov-main">
        <div className="ov-answer">{status?.active ? "Yes!" : "No!"}</div>
        <div className="ov-detail">
          {status?.active ? (
            <>
              <span className="ov-tier">{tier}</span>
              {status.is_hard ? <span className="ov-sp">Steel Path</span> : null}
              <span className="ov-label">Void Cascade</span>
            </>
          ) : (
            <span className="ov-label">No Cascade — Omnia reset</span>
          )}
        </div>
      </div>
      <div className="ov-timer">
        <Countdown
          iso={status?.active ? status?.expiry : status?.omnia_reset}
          warnMs={15 * 60_000}
          soonMs={5 * 60_000}
        />
      </div>
    </div>
  );
}
