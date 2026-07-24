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
//
// Layout: a top-center strip, one card panel per on-screen reward, left to
// right mirroring the game's own card order (`card_index`). Use
// `key={r.card_index}` — NOT `reward_name` — because radshare can legitimately
// show duplicate names across cards. Unreadable cards still hold their slot
// as a dashed "?" panel.
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
        <div className="rc-strip">
          {capture.rewards.map((r) =>
            r.unread ? (
              <div className="rc-card rc-unread" key={r.card_index}>
                <div className="rc-q">?</div>
                <div className="rc-unread-note">unreadable · Alt+T retries</div>
              </div>
            ) : (
              <div className={`rc-card${r.best ? " rc-best" : ""}`} key={r.card_index}>
                <div className="rc-name">{r.reward_name}</div>
                <div className="rc-price">
                  <span className="rc-plat">{r.plat != null ? `${r.plat}p` : "—"}</span>
                  <span className="rc-ducats">{r.ducats != null ? `${r.ducats}d` : ""}</span>
                </div>
                <div className="rc-sub">
                  {r.ducats_per_plat != null ? `${r.ducats_per_plat} d/p` : ""}
                  {r.owned_qty > 0 ? ` · ×${r.owned_qty} owned` : ""}
                </div>
                {r.wanted || r.set_slug ? (
                  <div className="rc-chips">
                    {r.wanted ? <span className="rc-chip rc-wanted">◆ wanted</span> : null}
                    {r.set_slug ? <span className="rc-chip rc-set">◆ set</span> : null}
                  </div>
                ) : null}
                {r.best ? (
                  <div className="rc-pick">
                    ▶ pick
                    {r.pick_reason === "wanted"
                      ? " — wanted"
                      : r.pick_reason === "set"
                        ? " — completes set"
                        : " — best price"}
                  </div>
                ) : null}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
