import { useState } from "react";
import {
  useGameScanApply,
  useGameScanConsent,
  useGameScanPreview,
  useGameScanRevoke,
  useGameScanStatus,
} from "../hooks/queries";
import { useEscape } from "../hooks/useEscape";
import type { ScanDiffRow } from "../lib/types";
import { Scrim } from "./ui";

// The exact phrase the backend (gamescan::consent) requires. Kept in sync by hand.
const CONSENT_PHRASE = "I understand and accept the risk involved in using this functionality.";

export function errMessage(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

/** The reviewable diff (added / changed / removed) before anything is written.
 *  Shared: opened from Settings' GameScanPanel and the topbar SyncNow button. */
export function ReviewPanel({ rows, onClose }: { rows: ScanDiffRow[]; onClose: () => void }) {
  const apply = useGameScanApply();
  // Everything checked by default; the scan is ground truth and the user vetted it.
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(rows.map((r) => [r.slug, true])),
  );

  const selected = rows.filter((r) => checked[r.slug]);
  useEscape(onClose);

  return (
    <Scrim onClose={onClose}>
      <div className="modal" style={{ maxWidth: 760 }}>
        <div className="modal-h">
          <h2>Review game scan</h2>
          <span style={{ flex: 1 }} />
          <button type="button" className="x" onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={{ overflow: "auto", minHeight: 0 }}>
          <table className="dtable">
            <thead>
              <tr>
                <th style={{ width: 32 }} />
                <th>Item</th>
                <th>Change</th>
                <th className="r">Have now</th>
                <th className="r">Scan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked[r.slug] ?? false}
                      onChange={(e) => setChecked((c) => ({ ...c, [r.slug]: e.target.checked }))}
                    />
                  </td>
                  <td>{r.display_name}</td>
                  <td>
                    <span className={`tag ${r.status}`}>{r.status}</span>
                    {r.source && r.source !== "de_scan" ? (
                      <span className="muted" style={{ marginLeft: 6 }}>
                        ({r.source})
                      </span>
                    ) : null}
                  </td>
                  <td className="r">{r.current_qty}</td>
                  <td className="r">{r.status === "removed" ? "—" : r.scan_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-f">
          <div className="info">
            The scan is authoritative for its rows; your <b>manual</b> items are never auto-removed.
          </div>
          <span className="sp" style={{ flex: 1 }} />
          {apply.isError ? (
            <span className="muted neg" style={{ marginRight: 8 }}>
              {errMessage(apply.error)}
            </span>
          ) : null}
          <button
            type="button"
            className="btn pri"
            disabled={apply.isPending || selected.length === 0}
            onClick={() =>
              apply.mutate(
                selected.map((r) => ({ slug: r.slug, scan_qty: r.scan_qty, ranks: r.ranks })),
                { onSuccess: onClose },
              )
            }
          >
            {apply.isPending
              ? "Applying…"
              : `Apply ${selected.length} change${selected.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </Scrim>
  );
}

export function GameScanPanel() {
  const { data: status } = useGameScanStatus();
  const consent = useGameScanConsent();
  const revoke = useGameScanRevoke();
  const preview = useGameScanPreview();
  const [phrase, setPhrase] = useState("");
  const [diff, setDiff] = useState<ScanDiffRow[] | null>(null);

  const supported = status?.supported ?? false;
  const consented = status?.consented ?? false;
  const running = status?.warframe_running ?? false;

  const runScan = async () => {
    try {
      const rows = await preview.mutateAsync();
      setDiff(rows);
    } catch {
      /* error surfaced via preview.isError below */
    }
  };

  return (
    <section className="tpanel">
      <div className="tpanel-h">
        <h3>Game inventory (beta)</h3>
        <span className="meta neg">ban-risk · off by default</span>
      </div>

      <div className="set-row">
        <div className="set-l">
          <div className="set-k">Read owned items from the running game</div>
          <div className="set-h">
            Reads the live Warframe client's memory to import your <b>true owned counts</b> — the
            one thing warframe.market can't give. This{" "}
            <b>violates DE's Terms of Service and could get your account banned.</b> Opt-in,
            Linux-only, never logs in.
          </div>
        </div>
        <div className="set-c">
          {!supported ? (
            <span className="muted">Linux only</span>
          ) : consented ? (
            <span className="seg">
              <span className="chip" aria-pressed>
                Consented
              </span>
              <button
                type="button"
                className="chip"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate()}
              >
                Revoke
              </button>
            </span>
          ) : null}
        </div>
      </div>

      {supported && !consented ? (
        <div className="set-row">
          <div className="set-l">
            <div className="set-k">Accept the risk to enable</div>
            <div className="set-h">
              Type exactly: <code>{CONSENT_PHRASE}</code>
            </div>
          </div>
          <div className="set-c" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={phrase}
              placeholder="type the phrase…"
              onChange={(e) => setPhrase(e.target.value)}
              style={{
                width: 280,
                background: "var(--panel)",
                color: "var(--ink)",
                border: "1px solid var(--line-2)",
                padding: "4px 6px",
              }}
            />
            <button
              type="button"
              className="btn warn"
              disabled={phrase.trim() !== CONSENT_PHRASE || consent.isPending}
              onClick={() => consent.mutate(phrase, { onSuccess: () => setPhrase("") })}
            >
              {consent.isPending ? "…" : "I accept"}
            </button>
          </div>
        </div>
      ) : null}

      {supported && consented ? (
        <div className="set-row">
          <div className="set-l">
            <div className="set-k">Scan now</div>
            <div className="set-h">
              {running
                ? "Warframe detected — scan, review the diff, then apply."
                : "Start Warframe and log in; this button enables once it's detected."}
            </div>
          </div>
          <div className="set-c">
            <button
              type="button"
              className="btn"
              disabled={!running || preview.isPending}
              onClick={runScan}
            >
              {preview.isPending ? "Scanning…" : "Scan now"}
            </button>
          </div>
        </div>
      ) : null}

      {preview.isError ? (
        <div className="set-row">
          <div className="set-l">
            <div className="set-h neg">{errMessage(preview.error)}</div>
          </div>
          <div className="set-c" />
        </div>
      ) : null}

      {diff ? <ReviewPanel rows={diff} onClose={() => setDiff(null)} /> : null}
    </section>
  );
}
