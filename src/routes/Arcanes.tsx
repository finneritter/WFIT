import { ItemTags } from "../components/ItemTags";
import { ItemName, StatBox, TableStatus, rowAction } from "../components/ui";
import { useArcaneDashboard, useListedSlugs } from "../hooks/queries";
import { fmt } from "../lib/format";

// Surfaced from the arcane-economy research (docs/ARCANE_DISSOLUTION.md). None of
// these compute collection Vosfor-EV — this screen is the novel bit.
const TOOLS = [
  "warframe.market — live prices",
  "Overframe — arcane DB",
  "AlecaFrame — inventory sync",
];

export function Arcanes({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data, isLoading, isError } = useArcaneDashboard();
  const listed = useListedSlugs();
  const s = data?.summary;
  const collections = data?.collections ?? [];
  const owned = data?.owned ?? [];

  return (
    <>
      <div className="statband" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <StatBox k="Sell value" v={fmt(s?.sell_plat)} unit="p" d="recommended sells" dcls="muted" />
        <StatBox
          k="Vosfor (dissolve)"
          v={fmt(s?.total_vosfor)}
          unit="vf"
          d={s ? `≈ ${fmt(Math.round(s.total_vosfor * s.plat_per_vosfor))}p` : undefined}
          dcls="muted"
        />
        <StatBox
          k="Best collection"
          v={s?.best_collection ?? "—"}
          d={s ? `${s.best_plat_per_200.toFixed(1)}p / 200 vf` : undefined}
          dcls="muted"
        />
        <StatBox
          k="Vosfor rate"
          v={s ? s.plat_per_vosfor.toFixed(2) : "—"}
          unit="p/vf"
          d="best collection"
          dcls="muted"
        />
      </div>

      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Best collection to spend Vosfor on</h3>
          <span className="meta">realizable platinum per 200 Vosfor pull (liquidity-adjusted)</span>
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
            {isLoading || isError || collections.length === 0 ? (
              <TableStatus
                span={6}
                loading={isLoading}
                error={isError}
                emptyText="No collection data yet."
              />
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
          <h3>Your arcanes — sell or dissolve</h3>
          <span className="meta">
            sell unranked spares for plat, or dissolve into Vosfor — whichever's worth more
          </span>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Arcane</th>
              <th className="r">Unranked</th>
              <th>Recommendation</th>
              <th className="r">Value</th>
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || owned.length === 0 ? (
              <TableStatus
                span={4}
                loading={isLoading}
                error={isError}
                emptyText="No arcanes owned yet."
              />
            ) : (
              owned.map((a) => (
                <tr key={a.slug} {...rowAction(() => onOpen(a.slug))}>
                  <td>
                    <ItemName
                      name={a.display_name}
                      plat={a.plat}
                      thumb={a.thumbnail_url}
                      sub={
                        <>
                          {a.collection ?? "no collection"} · {a.rank0_copies} unranked
                          {a.rank0_copies !== a.qty ? ` of ${a.qty}` : ""}
                        </>
                      }
                      tags={<ItemTags trend={a.trend} listed={listed.has(a.slug)} />}
                    />
                  </td>
                  <td className="r">{a.plat == null ? "—" : `${fmt(a.plat)}p`}</td>
                  <td>
                    <span className="arc-rec">
                      {a.sell_qty > 0 ? (
                        <span className="badge sell">
                          sell {a.sell_qty} · {fmt(a.sell_plat)}p
                        </span>
                      ) : null}
                      {a.dissolve_qty > 0 ? (
                        <span className="badge dissolve">
                          vosfor {a.dissolve_qty} · {fmt(a.vosfor_total)} vf
                        </span>
                      ) : null}
                      {a.sell_qty === 0 && a.dissolve_qty === 0 ? (
                        <span className="muted">—</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="r num">{fmt(a.sell_plat + a.dissolve_plat_equiv)}p</td>
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
