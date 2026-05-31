import { useState } from "react";
import { Glyph, StatBox } from "../components/ui";
import {
  useListings,
  useWfmAccount,
  useWfmApplyImport,
  useWfmConnect,
  useWfmSetSession,
  useWfmSignout,
  useWfmSync,
} from "../hooks/queries";
import { wfmFetchListings } from "../lib/api";
import { clsx, fmt } from "../lib/format";
import type { ImportRow } from "../lib/types";

function SignInCard() {
  const connect = useWfmConnect();
  const setSession = useWfmSetSession();
  const [username, setUsername] = useState("");
  const [jwt, setJwt] = useState("");

  return (
    <div className="tpanel" style={{ maxWidth: 520 }}>
      <div className="tpanel-h">
        <h3>Connect warframe.market</h3>
      </div>
      <div className="content" style={{ padding: 14 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Read-only. WFIT imports your <b>listings</b> (orders), not your in-game inventory — there's
          no DE inventory API. Tier 1 needs only your public username.
        </p>
        <div className="search" style={{ marginBottom: 8 }}>
          <input
            placeholder="warframe.market username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn pri"
          disabled={!username.trim() || connect.isPending}
          onClick={() => connect.mutate(username.trim())}
        >
          {connect.isPending ? "Connecting…" : "Connect"}
        </button>
        {connect.isError ? (
          <div className="conn-note" style={{ marginTop: 8 }}>
            {(connect.error as Error).message}
          </div>
        ) : null}

        <div className="grp" style={{ paddingLeft: 0 }}>
          Optional · invisible orders
        </div>
        <div className="search" style={{ marginBottom: 8 }}>
          <input
            placeholder="paste JWT (stored in OS keychain)"
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn"
          disabled={!jwt.trim() || setSession.isPending}
          onClick={() => setSession.mutate(jwt.trim())}
        >
          {setSession.isPending ? "Validating…" : "Save session token"}
        </button>
      </div>
    </div>
  );
}

function ImportPanel({ rows, onClose }: { rows: ImportRow[]; onClose: () => void }) {
  const apply = useWfmApplyImport();
  const [sel, setSel] = useState<Record<string, number>>(
    Object.fromEntries(rows.map((r) => [r.slug, r.listed_qty])),
  );
  return (
    <div className="tpanel" style={{ marginBottom: 12 }}>
      <div className="tpanel-h">
        <h3>Review import — listings, not inventory</h3>
        <span style={{ flex: 1 }} />
        <button type="button" className="x" onClick={onClose}>
          ✕
        </button>
      </div>
      <table className="dtable">
        <thead>
          <tr>
            <th>Item</th>
            <th className="r">Listed</th>
            <th className="r">Have now</th>
            <th className="r">Import qty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slug}>
              <td>{r.display_name}</td>
              <td className="r">{r.listed_qty}</td>
              <td className="r">{r.current_qty}</td>
              <td className="r">
                <input
                  type="number"
                  style={{ width: 48, background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line-2)" }}
                  value={sel[r.slug] ?? 0}
                  onChange={(e) => setSel((s) => ({ ...s, [r.slug]: parseInt(e.target.value, 10) || 0 }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="modal-f">
        <div className="info">Merge keeps your larger manual counts.</div>
        <span className="sp" style={{ flex: 1 }} />
        <button
          type="button"
          className="btn pri"
          onClick={() =>
            apply.mutate(
              Object.entries(sel)
                .filter(([, q]) => q > 0)
                .map(([slug, qty]) => ({ slug, qty })),
              { onSuccess: onClose },
            )
          }
        >
          Import selected
        </button>
      </div>
    </div>
  );
}

export function Listings({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: account } = useWfmAccount();
  const { data: listings = [] } = useListings();
  const sync = useWfmSync();
  const signout = useWfmSignout();
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);

  if (!account?.connected) return <SignInCard />;

  const active = listings.length;
  const listedValue = listings.reduce((s, l) => s + (l.your_price ?? 0) * l.qty, 0);
  const atBest = listings.filter((l) => l.market_low != null && (l.your_price ?? 0) <= l.market_low).length;
  const undercut = listings.filter((l) => l.market_low != null && (l.your_price ?? 0) > l.market_low).length;

  return (
    <>
      <div className="conn">
        <span className={clsx("cdot", account.status ?? "offline")} />
        <span className="cinfo">
          Connected to <b>warframe.market</b> as <b>{account.username}</b>
          {account.has_session ? " · session active" : " · public"}
        </span>
        <span className="seg">
          {(["offline", "online", "ingame"] as const).map((s) => (
            <button key={s} type="button" className="segb" aria-pressed={account.status === s} disabled>
              {s === "ingame" ? "In Game" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </span>
        <button type="button" className="btn sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? "Syncing…" : "Sync now"}
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={async () => setImportRows(await wfmFetchListings())}
        >
          Import to inventory
        </button>
        <button type="button" className="btn sm" onClick={() => signout.mutate()}>
          Disconnect
        </button>
      </div>

      {importRows ? <ImportPanel rows={importRows} onClose={() => setImportRows(null)} /> : null}

      <div className="statband" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <StatBox k="Active listings" v={fmt(active)} />
        <StatBox k="Listed value" v={fmt(listedValue)} unit="p" />
        <StatBox k="At best price" v={fmt(atBest)} dcls="pos" />
        <StatBox k="Undercut" v={fmt(undercut)} dcls="neg" />
      </div>

      <div className="tpanel">
        <table className="dtable">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Your price</th>
              <th className="r">Qty</th>
              <th className="r">Market low</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {listings.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No sell orders found. Hit <b>Sync now</b> to refresh from warframe.market.
                </td>
              </tr>
            ) : (
              listings.map((l) => {
                const best = l.market_low != null && (l.your_price ?? 0) <= l.market_low;
                const over =
                  l.market_low != null && (l.your_price ?? 0) > l.market_low
                    ? (l.your_price ?? 0) - l.market_low
                    : 0;
                return (
                  <tr key={l.order_id} onClick={() => onOpen(l.slug)}>
                    <td>
                      <div className="dnm">
                        <Glyph name={l.display_name} plat={l.your_price} />
                        <div className="di">
                          <span className="nm">{l.display_name}</span>
                          <span className="sub">{l.part_type}</span>
                        </div>
                      </div>
                    </td>
                    <td className="r">{fmt(l.your_price)}p</td>
                    <td className="r">{l.qty}</td>
                    <td className="r">{fmt(l.market_low)}p</td>
                    <td>
                      {best ? (
                        <span className="badge at">best price</span>
                      ) : (
                        <span className="badge above">+{fmt(over)}p over</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
