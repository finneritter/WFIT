import { Glyph, StatBox } from "../components/ui";
import { useArcaneDashboard } from "../hooks/queries";
import { clsx, fmt } from "../lib/format";

// Surfaced from the arcane-economy research (docs/ARCANE_DISSOLUTION.md). None of
// these compute collection Vosfor-EV — this screen is the novel bit.
const TOOLS = [
  "warframe.market — live prices",
  "Overframe — arcane DB",
  "AlecaFrame — inventory sync",
];

export function Arcanes({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data, isLoading } = useArcaneDashboard();
  const s = data?.summary;
  const collections = data?.collections ?? [];
  const owned = data?.owned ?? [];

  return (
    <>
      <div className="statband" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <StatBox
          k="Vosfor if dissolved"
          v={fmt(s?.total_vosfor)}
          unit="vf"
          d="all unranked copies"
          dcls="muted"
        />
        <StatBox
          k="Best collection"
          v={s?.best_collection ?? "—"}
          d={s ? `${s.best_plat_per_200.toFixed(1)}p / 200 vf` : undefined}
          dcls="muted"
        />
        <StatBox k="Owned arcanes" v={fmt(s?.owned_count)} />
        <StatBox k="Sell value" v={fmt(s?.sell_plat)} unit="p" d="at rank-0 price" dcls="muted" />
      </div>

      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Best collection to spend Vosfor on</h3>
          <span className="meta">expected platinum per 200 Vosfor pull</span>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Collection</th>
              <th className="r">Plat / 200 vf</th>
              <th className="r">Plat / vf</th>
              <th className="r">Legendary</th>
              <th className="r">Priced</th>
              <th>Top hits</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="muted">
                  Loading…
                </td>
              </tr>
            ) : (
              collections.map((c) => (
                <tr key={c.key}>
                  <td>
                    <span className="nm">{c.name}</span>
                  </td>
                  <td className="r">{c.ev_plat_per_pull.toFixed(1)}p</td>
                  <td className="r">{c.plat_per_vosfor.toFixed(2)}</td>
                  <td className="r">{c.legendary_pct > 0 ? `${c.legendary_pct}%` : "—"}</td>
                  <td className="r">{Math.round(c.coverage * 100)}%</td>
                  <td className="sub">{c.top.map((t) => t.display_name).join(", ")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Your arcanes — dissolve or sell</h3>
          <span className="meta">{owned.length} owned</span>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Arcane</th>
              <th className="r">Sell</th>
              <th className="r">Vosfor</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="muted">
                  Loading…
                </td>
              </tr>
            ) : owned.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No arcanes owned yet.
                </td>
              </tr>
            ) : (
              owned.map((a) => (
                <tr key={a.slug} onClick={() => onOpen(a.slug)}>
                  <td>
                    <div className="dnm">
                      <Glyph name={a.display_name} plat={a.plat} thumb={a.thumbnail_url} />
                      <div className="di">
                        <span className="nm">{a.display_name}</span>
                        <span className="sub">
                          {a.collection ?? "no collection"} · ×{a.qty}
                          {a.rank0_copies !== a.qty ? ` (${a.rank0_copies} unranked)` : ""}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="r">{a.plat == null ? "—" : `${fmt(a.plat)}p`}</td>
                  <td className="r">{fmt(a.vosfor_total)} vf</td>
                  <td>
                    <span className={clsx("badge", a.verdict === "dissolve" && "at")}>
                      {a.verdict === "dissolve" ? "dissolve" : "sell"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="legend" style={{ gap: 14 }}>
        <span className="muted">Other arcane tools:</span>
        {TOOLS.map((t) => (
          <span key={t} className="muted">
            {t}
          </span>
        ))}
      </div>
    </>
  );
}
