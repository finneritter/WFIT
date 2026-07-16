import { listen } from "@tauri-apps/api/event";
// The relic-crack HUD box. Rust pushes a `CrackCapture` on every capture
// (event "relic-overlay-show"); we also fetch the last capture on mount so a
// rebuilt window (force-close recovery) renders without waiting for an event.
//
// Auto-hide is Rust-owned (src-tauri/src/relic_ocr/mod.rs) — the frontend
// never hides itself, so a throttled webview timer can't strand the box.
//
// Styling intent (issue #2): this must read like part of Warframe's own HUD,
// not an app window — see relic-overlay.css.
import { useEffect, useState } from "react";
import { getLastCrackCapture } from "../lib/api";
import type { CrackCapture } from "../lib/types";

export function RelicOverlay() {
  const [capture, setCapture] = useState<CrackCapture | null>(null);

  useEffect(() => {
    getLastCrackCapture()
      .then((c) => c && setCapture(c))
      .catch(() => {});
    const un = listen<CrackCapture>("relic-overlay-show", (e) => setCapture(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  if (!capture) return null;

  return (
    <div className="rc">
      <div className="rc-head">
        <span className="rc-title">Relic Rewards</span>
        <span className="rc-meta">{capture.ocr_ms > 0 ? `${capture.ocr_ms}ms` : ""}</span>
      </div>
      {capture.error ? (
        <div className="rc-error">{capture.error}</div>
      ) : (
        capture.rewards.map((r) => (
          <div className={`rc-row${r.best ? " rc-best" : ""}`} key={r.reward_name}>
            <span className="rc-name">
              {r.wanted ? <span className="rc-flag rc-wanted">◆ </span> : null}
              {r.set_slug ? <span className="rc-flag rc-set">◆ </span> : null}
              {r.reward_name}
            </span>
            <span className="rc-owned">{r.owned_qty > 0 ? `×${r.owned_qty}` : ""}</span>
            <span className="rc-plat">{r.plat != null ? `${r.plat}p` : "—"}</span>
            <span className="rc-ducats">{r.ducats != null ? `${r.ducats}d` : ""}</span>
            <span className="rc-ratio">
              {r.ducats_per_plat != null ? `${r.ducats_per_plat}d/p` : ""}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
