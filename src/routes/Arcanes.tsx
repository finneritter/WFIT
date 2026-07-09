import { useMemo, useState } from "react";
import { ItemTags } from "../components/ItemTags";
import { Chip, ItemName, Scrim, SortTh, StatBox, TableStatus, rowAction } from "../components/ui";
import { useArcaneDashboard, useCollectionBreakdown, useListedSlugs } from "../hooks/queries";
import { useDrawerResize } from "../hooks/useDrawerResize";
import { useEscape } from "../hooks/useEscape";
import { useColumnSort, usePaged } from "../hooks/useTable";
import { clsx, fmt } from "../lib/format";
import { usePersisted } from "../lib/persist";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { arcanesSchema } from "../lib/searchSchemas";
import type { CollectionEv, OwnedArcane } from "../lib/types";

// Surfaced from the arcane-economy research (docs/ARCANE_DISSOLUTION.md). None of
// these compute collection Vosfor-EV — this screen is the novel bit.
const TOOLS = [
  "warframe.market — live prices",
  "Overframe — arcane DB",
  "AlecaFrame — inventory sync",
];

const RARITY_RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, legendary: 3 };
const ownedValue = (a: OwnedArcane) => a.sell_plat + a.dissolve_plat_equiv;

type ColCol = "name" | "per200" | "pervf" | "legendary" | "priced" | "pool";
const COLL_CMP: Record<ColCol, (a: CollectionEv, b: CollectionEv) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  per200: (a, b) => a.ev_plat_per_pull - b.ev_plat_per_pull,
  pervf: (a, b) => a.plat_per_vosfor - b.plat_per_vosfor,
  legendary: (a, b) => a.legendary_pct - b.legendary_pct,
  priced: (a, b) => a.coverage - b.coverage,
  pool: (a, b) => a.pool_size - b.pool_size,
};

type OwnCol = "name" | "unranked" | "rarity" | "value";
const OWN_CMP: Record<OwnCol, (a: OwnedArcane, b: OwnedArcane) => number> = {
  name: (a, b) => a.display_name.localeCompare(b.display_name),
  unranked: (a, b) => (a.plat ?? 0) - (b.plat ?? 0),
  rarity: (a, b) => (RARITY_RANK[a.rarity ?? ""] ?? -1) - (RARITY_RANK[b.rarity ?? ""] ?? -1),
  value: (a, b) => ownedValue(a) - ownedValue(b),
};

export function Arcanes({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data, isLoading, isError } = useArcaneDashboard();
  const listed = useListedSlugs();
  const s = data?.summary;
  const collections = data?.collections ?? [];
  const owned = data?.owned ?? [];

  const search = usePageSearch();
  const [openCol, setOpenCol] = useState<CollectionEv | null>(null);
  const [sellOnly, setSellOnly] = usePersisted<"1" | "0">("wfit-arc-sell", "0");
  const [dissolveOnly, setDissolveOnly] = usePersisted<"1" | "0">("wfit-arc-dissolve", "0");
  const [noCommon, setNoCommon] = usePersisted<"1" | "0">("wfit-arc-nocommon", "0");
  const coll = useColumnSort<CollectionEv, ColCol>("wfit-arc-coll-sort", COLL_CMP, {
    key: "per200",
    dir: "desc",
  });
  const own = useColumnSort<OwnedArcane, OwnCol>("wfit-arc-own-sort", OWN_CMP, {
    key: "value",
    dir: "desc",
  });

  const sortedColls = useMemo(() => coll.apply(collections), [collections, coll.apply]);

  const { test } = useMemo(() => compileQuery(search, arcanesSchema), [search]);
  const ownedView = useMemo(() => {
    const filtered = owned.filter((a) => {
      if (sellOnly === "1" && a.sell_qty === 0) return false;
      if (dissolveOnly === "1" && a.dissolve_qty === 0) return false;
      if (noCommon === "1" && a.rarity === "common") return false;
      return test(a);
    });
    return own.apply(filtered);
  }, [owned, sellOnly, dissolveOnly, noCommon, test, own.apply]);
  const ownedPage = usePaged(
    ownedView,
    50,
    `${sellOnly}|${dissolveOnly}|${noCommon}|${search}|${own.sort ? own.sort.key + own.sort.dir : ""}`,
  );

  // Footer totals over the whole filtered view (not just the visible page).
  const ownedTotals = useMemo(() => {
    let sell = 0;
    let vosfor = 0;
    let value = 0;
    for (const a of ownedView) {
      sell += a.sell_plat;
      vosfor += a.vosfor_total;
      value += ownedValue(a);
    }
    return { sell, vosfor, value };
  }, [ownedView]);
  const bestColl = useMemo(
    () =>
      collections.reduce<CollectionEv | null>(
        (best, c) => (best == null || c.ev_plat_per_pull > best.ev_plat_per_pull ? c : best),
        null,
      ),
    [collections],
  );

  return (
    <>
      <div className="statband">
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
          <h3 title="Realizable platinum per 200 Vosfor pull (liquidity-adjusted). Click a row for the breakdown.">
            Best collection to spend Vosfor on
          </h3>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <SortTh<ColCol> label="Collection" col="name" sort={coll.sort} onSort={coll.cycle} />
              <SortTh<ColCol>
                label="Plat / 200 vf"
                col="per200"
                sort={coll.sort}
                onSort={coll.cycle}
                right
              />
              <SortTh<ColCol>
                label="Plat / vf"
                col="pervf"
                sort={coll.sort}
                onSort={coll.cycle}
                right
              />
              <SortTh<ColCol>
                label="Legendary"
                col="legendary"
                sort={coll.sort}
                onSort={coll.cycle}
                right
              />
              <SortTh<ColCol>
                label="Priced"
                col="priced"
                sort={coll.sort}
                onSort={coll.cycle}
                right
              />
              <SortTh<ColCol> label="Pool" col="pool" sort={coll.sort} onSort={coll.cycle} right />
              <th>Top hits</th>
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || sortedColls.length === 0 ? (
              <TableStatus
                span={7}
                loading={isLoading}
                error={isError}
                emptyText="No collection data yet."
              />
            ) : (
              sortedColls.map((c) => (
                <tr key={c.key} {...rowAction(() => setOpenCol(c))} title="View arcane breakdown">
                  <td>
                    <span className="nm">{c.name}</span>
                  </td>
                  <td className="r">{c.ev_plat_per_pull.toFixed(1)}p</td>
                  <td className="r">{c.plat_per_vosfor.toFixed(2)}</td>
                  <td className="r">{c.legendary_pct > 0 ? `${c.legendary_pct}%` : "—"}</td>
                  <td className="r">{Math.round(c.coverage * 100)}%</td>
                  <td className="r num">{fmt(c.pool_size)}</td>
                  <td className="sub">{c.top.map((t) => t.display_name).join(", ")}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7}>
                <span className="num">{fmt(sortedColls.length)}</span> collections · best{" "}
                {bestColl ? (
                  <>
                    {bestColl.name} at{" "}
                    <span className="num">{bestColl.ev_plat_per_pull.toFixed(1)}p</span> / 200 vf
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="tpanel">
        <div className="tpanel-h">
          <h3 title="Sell unranked spares for plat, or dissolve into Vosfor — whichever's worth more.">
            Your arcanes — sell or dissolve
          </h3>
        </div>
        <div className="mkt-filters" style={{ margin: "0 0 10px" }}>
          <Chip active={sellOnly === "1"} onClick={() => setSellOnly(sellOnly === "1" ? "0" : "1")}>
            Sell only
          </Chip>
          <Chip
            active={dissolveOnly === "1"}
            onClick={() => setDissolveOnly(dissolveOnly === "1" ? "0" : "1")}
          >
            Dissolve only
          </Chip>
          <Chip active={noCommon === "1"} onClick={() => setNoCommon(noCommon === "1" ? "0" : "1")}>
            Hide common
          </Chip>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <SortTh<OwnCol> label="Arcane" col="name" sort={own.sort} onSort={own.cycle} />
              <SortTh<OwnCol>
                label="Unranked"
                col="unranked"
                sort={own.sort}
                onSort={own.cycle}
                right
              />
              <SortTh<OwnCol> label="Rarity" col="rarity" sort={own.sort} onSort={own.cycle} />
              <th>Recommendation</th>
              <SortTh<OwnCol> label="Value" col="value" sort={own.sort} onSort={own.cycle} right />
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || ownedPage.visible.length === 0 ? (
              <TableStatus
                span={5}
                loading={isLoading}
                error={isError}
                emptyText="No arcanes owned yet."
              />
            ) : (
              ownedPage.visible.map((a) => (
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
                  <td className={clsx("rarity", a.rarity)}>{a.rarity ?? "—"}</td>
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
                  <td className="r num">{fmt(ownedValue(a))}p</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>
                <span className="num">{fmt(ownedView.length)}</span> arcanes · sell{" "}
                <span className="num">{fmt(ownedTotals.sell)}p</span> · dissolve{" "}
                <span className="num">{fmt(ownedTotals.vosfor)}</span> vf · total{" "}
                <span className="num">{fmt(ownedTotals.value)}p</span>
              </td>
            </tr>
          </tfoot>
        </table>
        {ownedPage.hasMore ? (
          <button type="button" className="btn load-more" onClick={ownedPage.more}>
            Showing {ownedPage.shown} of {fmt(ownedPage.total)} — load more
          </button>
        ) : null}
      </div>

      <div className="legend" style={{ gap: 14 }}>
        <span className="muted">Other arcane tools:</span>
        {TOOLS.map((t) => (
          <span key={t} className="muted">
            {t}
          </span>
        ))}
      </div>

      {openCol ? (
        <CollectionDrawer collection={openCol} onOpen={onOpen} onClose={() => setOpenCol(null)} />
      ) : null}
    </>
  );
}

/// What's driving a collection's value: every arcane in it with its plat price and
/// Vosfor, sorted by EV contribution. A right-side resizable drawer (the Relic/Set
/// drawer affordance); arcane names close it and open the item Drawer.
function CollectionDrawer({
  collection: c,
  onOpen,
  onClose,
}: {
  collection: CollectionEv;
  onOpen: (slug: string) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const { data: rows = [], isLoading, isError } = useCollectionBreakdown(c.key);
  const { width, startResize } = useDrawerResize("wfit.arcaneDrawerWidth", 400, 480);

  return (
    <Scrim className="scrim" onClose={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only resize affordance (no keyboard equivalent) */}
      <div
        className="drawer-grip"
        style={{ right: width }}
        onPointerDown={startResize}
        onClick={(e) => e.stopPropagation()}
        title="Drag to resize"
      />
      <div className="drawer" style={{ width }}>
        <div className="drawer-h">
          <div className="di">
            <div className="nm">{c.name}</div>
            <div className="sub">Vosfor collection · {fmt(c.pool_size)} arcanes in the pool</div>
          </div>
          <button type="button" className="x" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {/* Collection headline (reuses the row data — no refetch). */}
          <div className="dgrid lf-grid">
            <div className="cell">
              <div className="k">Plat / 200 vf</div>
              <div className="v">{c.ev_plat_per_pull.toFixed(1)}p</div>
            </div>
            <div className="cell">
              <div className="k">Plat / vf</div>
              <div className="v">{c.plat_per_vosfor.toFixed(2)}</div>
            </div>
            <div className="cell">
              <div className="k">Legendary</div>
              <div className="v">{c.legendary_pct > 0 ? `${c.legendary_pct}%` : "—"}</div>
            </div>
            <div className="cell">
              <div className="k">Priced</div>
              <div className="v">{Math.round(c.coverage * 100)}%</div>
            </div>
            <div className="cell">
              <div className="k">Pool</div>
              <div className="v">{fmt(c.pool_size)}</div>
            </div>
          </div>

          <div className="rankbox">
            <div className="rankbox-h">
              <b>Arcanes</b>
              <span className="muted"> · by EV contribution — names open the item drawer</span>
            </div>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Arcane</th>
                  <th className="r">Plat</th>
                  <th className="r">Vosfor</th>
                </tr>
              </thead>
              <tbody>
                {isLoading || isError || rows.length === 0 ? (
                  <TableStatus
                    span={3}
                    loading={isLoading}
                    error={isError}
                    emptyText="No arcanes in this collection."
                  />
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.slug}
                      {...rowAction(() => {
                        onClose();
                        onOpen(r.slug);
                      })}
                    >
                      <td>
                        <ItemName
                          name={r.display_name}
                          plat={r.plat}
                          thumb={r.thumbnail_url}
                          sub={`${r.rarity} · ${(r.prob * 100).toFixed(1)}% / draw`}
                        />
                      </td>
                      <td className="r">{r.plat == null ? "—" : `${fmt(r.plat)}p`}</td>
                      <td className="r num">{fmt(r.vosfor)} vf</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Scrim>
  );
}
