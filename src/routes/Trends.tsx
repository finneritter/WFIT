import { useMemo } from "react";
import { MiniArea, RangeBar, Spark } from "../components/charts";
import { BlockStatus, Chip, ItemName, SortTh, TableStatus, rowAction } from "../components/ui";
import { useTrends } from "../hooks/queries";
import { useColumnSort, usePaged } from "../hooks/useTable";
import { CATEGORY_LABELS, clsx, fmt, pct } from "../lib/format";
import { usePersisted } from "../lib/persist";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { trendsSchema } from "../lib/searchSchemas";
import type { HeatRow, TrendRow } from "../lib/types";

const TFS = ["24h", "7d", "30d", "90d"] as const;

/** Headline % move plus the volatility-normalized z-score (the "is this actually
 *  unusual?" signal). The σ badge lights up once the move clears ±1 std dev. */
function Move({ delta, z }: { delta: number; z: number }) {
  const cls = delta >= 0 ? "pos" : "neg";
  const notable = Math.abs(z) >= 1;
  return (
    <span className="mv">
      <span className={clsx("mvd num", cls)}>{pct(delta)}</span>
      <span className={clsx("zbadge num", notable ? cls : "muted")}>
        {z >= 0 ? "+" : ""}
        {z.toFixed(1)}σ
      </span>
    </span>
  );
}

type Signal = "sell" | "buy" | "unusual";
const SIGNAL_CHIPS: [Signal, string, string][] = [
  ["sell", "Sell signals", "items you own, high in range or spiking"],
  ["buy", "Buy / flip", "liquid items low in their range"],
  ["unusual", "Unusual moves", "volatility-adjusted movers"],
];

/** One table row: the trend data plus which signal lists surfaced it. */
type SignalRow = { row: TrendRow; signals: Set<Signal> };

type Col = "name" | "range" | "price" | "move" | "z" | "volume";
const CMP: Record<Col, (a: SignalRow, b: SignalRow) => number> = {
  name: (a, b) => a.row.display_name.localeCompare(b.row.display_name),
  range: (a, b) => a.row.range_pos - b.row.range_pos,
  price: (a, b) => (a.row.median_plat ?? 0) - (b.row.median_plat ?? 0),
  move: (a, b) => a.row.delta - b.row.delta,
  z: (a, b) => a.row.z - b.row.z,
  volume: (a, b) => a.row.volume - b.row.volume,
};

// Default order (no column chosen): biggest absolute move first — the screen's
// "what's happening" question.
function moveOrder(a: SignalRow, b: SignalRow): number {
  return (
    Math.abs(b.row.delta) - Math.abs(a.row.delta) ||
    a.row.display_name.localeCompare(b.row.display_name)
  );
}

function HeatRowView({ row, scale }: { row: HeatRow; scale: number }) {
  const w = Math.min(50, (Math.abs(row.avg_delta) / scale) * 50);
  const pos = row.avg_delta >= 0;
  return (
    <div className="heatrow">
      <span className="hc">
        {CATEGORY_LABELS[row.category]} <small>{row.count}</small>
      </span>
      <span className="heatbar">
        <span className="zero" />
        <i
          style={{
            left: pos ? "50%" : `${50 - w}%`,
            width: `${w}%`,
            background: pos ? "var(--pos)" : "var(--neg)",
          }}
        />
      </span>
      <span className={clsx("hv", pos ? "pos" : "neg")}>{pct(row.avg_delta)}</span>
    </div>
  );
}

export function Trends({ onOpen }: { onOpen: (slug: string) => void }) {
  const [tf, setTf] = usePersisted<(typeof TFS)[number]>("wfit-trends-tf", "7d");
  const [outliers, setOutliers] = usePersisted<"1" | "0">("wfit-trends-outliers", "1");
  const [signalFilter, setSignalFilter] = usePersisted<Signal | "all">("wfit-trends-signal", "all");
  const excludeOutliers = outliers === "1";
  const { data, isLoading, isError } = useTrends(tf, excludeOutliers);
  const sort = useColumnSort<SignalRow, Col>("wfit-trends-sort", CMP, null);

  const search = usePageSearch();
  const { test } = useMemo(() => compileQuery(search, trendsSchema), [search]);

  // The three backend signal lists merge into one table; a row keeps every
  // signal it appears under (an owned spike can be both "sell" and "unusual").
  const merged = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, SignalRow>();
    const add = (rows: TrendRow[], s: Signal) => {
      for (const r of rows) {
        const e = by.get(r.slug);
        if (e) e.signals.add(s);
        else by.set(r.slug, { row: r, signals: new Set([s]) });
      }
    };
    add(data.sell_signals, "sell");
    add(data.buy_candidates, "buy");
    add(data.unusual, "unusual");
    return [...by.values()];
  }, [data]);

  const view = useMemo(() => {
    const filtered = merged.filter(
      (e) => test(e.row) && (signalFilter === "all" || e.signals.has(signalFilter)),
    );
    return sort.sort ? sort.apply(filtered) : [...filtered].sort(moveOrder);
  }, [merged, test, signalFilter, sort.sort, sort.apply]);

  // Reset paging only when the filters change — not on the heartbeat refetch
  // that hands back fresh arrays every ~45-60s.
  const pageKey = `${tf}|${outliers}|${search}|${signalFilter}|${sort.sort ? sort.sort.key + sort.sort.dir : ""}`;
  const { visible, hasMore, shown, total, more } = usePaged(view, 25, pageKey);

  const breadth = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const e of view) {
      if (e.row.delta > 0) up += 1;
      else if (e.row.delta < 0) down += 1;
    }
    return { up, down, flat: view.length - up - down };
  }, [view]);

  if (isError)
    return <BlockStatus error text="Couldn't load market trends. Try again in a moment." />;
  if (isLoading || !data) return <BlockStatus text="Loading market trends…" />;

  const heatScale = Math.max(1, ...data.category_heat.map((h) => Math.abs(h.avg_delta)));

  return (
    <>
      {/* Market hero — the big picture, fills the first screen */}
      <div className="market-hero">
        <div className="mh-top">
          <div className="mh-head">
            <span className="mh-label">Prime Market</span>
            <span className="mh-span">{tf} index · liquid basket</span>
          </div>
          <div className="mh-figure">
            <span className={clsx("mh-chg num", data.index_change >= 0 ? "pos" : "neg")}>
              {pct(data.index_change)}
            </span>
            <span className="mh-breadth">
              <b className="up">{data.advancing}</b> up · <b className="dn">{data.declining}</b>{" "}
              down · <b>{data.flat}</b> flat
              <span className="mh-liq">
                · {fmt(data.liquid_count)} liquid of {fmt(data.total_priced)} priced
              </span>
            </span>
          </div>
        </div>
        <div className="mh-chart">
          <MiniArea
            data={data.index_spark}
            w={1200}
            h={360}
            accent={data.index_change >= 0 ? "var(--pos)" : "var(--neg)"}
          />
        </div>
      </div>

      {/* Your holdings — compact band */}
      <div className="tpanel band hold-band">
        <div className="tpanel-h">
          <h3>Your holdings</h3>
          {/* pinned to 7d (not the timeframe chips) — mirrors the Inventory header */}
          <span className="meta">7d</span>
        </div>
        {data.holdings_value > 0 ? (
          <div className="bandtop">
            <span
              className="bandval num"
              title="Realizable (liquidation-adjusted) value, matching the Inventory headline"
            >
              ~{fmt(data.holdings_value)}p
            </span>
            <span
              className={clsx("bandchg num", data.holdings_change >= 0 ? "pos" : "neg")}
              title="Value-weighted 7d change — matches the Inventory header"
            >
              {pct(data.holdings_change)}
            </span>
            <span className="breadth">
              <b className={data.sell_signal_count > 0 ? "up" : ""}>{data.sell_signal_count}</b>{" "}
              sell signal{data.sell_signal_count === 1 ? "" : "s"}
            </span>
          </div>
        ) : (
          <div className="empty">No priced items owned yet.</div>
        )}
      </div>

      {/* Signal controls: timeframe + signal-type filter + outlier clamp */}
      <div className="tf-row">
        <span className="lbl">timeframe</span>
        {TFS.map((t) => (
          <button
            key={t}
            type="button"
            className="chip"
            aria-pressed={tf === t}
            onClick={() => setTf(t)}
          >
            {t}
          </button>
        ))}
        <span className="sp" />
        {SIGNAL_CHIPS.map(([s, label, hint]) => (
          <span key={s} title={hint}>
            <Chip
              active={signalFilter === s}
              onClick={() => setSignalFilter(signalFilter === s ? "all" : s)}
            >
              {label}
            </Chip>
          </span>
        ))}
        <button
          type="button"
          className="chip"
          aria-pressed={excludeOutliers}
          title="Clamp troll/fat-finger price prints so they don't skew the index or signals"
          onClick={() => setOutliers(excludeOutliers ? "0" : "1")}
        >
          Exclude outliers
        </button>
      </div>

      {/* The signal table — every mover in one sortable place */}
      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Signals</h3>
          <span className="meta">{tf} · click a row for the item</span>
        </div>
        <table className="dtable trend-table">
          <thead>
            <tr>
              <SortTh<Col> label="Item" col="name" sort={sort.sort} onSort={sort.cycle} />
              <SortTh<Col> label="Range" col="range" sort={sort.sort} onSort={sort.cycle} />
              <th className="tt-spark">Spark</th>
              <SortTh<Col> label="Price" col="price" sort={sort.sort} onSort={sort.cycle} right />
              <SortTh<Col> label="Move" col="move" sort={sort.sort} onSort={sort.cycle} right />
              <SortTh<Col> label="Volume" col="volume" sort={sort.sort} onSort={sort.cycle} right />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <TableStatus
                span={6}
                loading={false}
                error={false}
                emptyText="Nothing moving under the current filters."
              />
            ) : (
              visible.map((e) => (
                <tr key={e.row.slug} {...rowAction(() => onOpen(e.row.slug))}>
                  <td>
                    <ItemName
                      name={e.row.display_name}
                      plat={e.row.median_plat}
                      thumb={e.row.thumbnail_url}
                      sub={
                        e.row.owned_qty > 0
                          ? `you own ×${e.row.owned_qty}`
                          : e.row.on_watchlist
                            ? "on watchlist"
                            : undefined
                      }
                      tags={
                        <>
                          {e.signals.has("sell") ? (
                            <span
                              className="itag itag-sell"
                              title="you own this — high in range or spiking"
                            >
                              SELL
                            </span>
                          ) : null}
                          {e.signals.has("buy") ? (
                            <span className="itag itag-buy" title="liquid and low in its range">
                              BUY
                            </span>
                          ) : null}
                          {e.signals.has("unusual") ? (
                            <span
                              className="itag itag-unusual"
                              title="unusual volatility-adjusted move"
                            >
                              σ
                            </span>
                          ) : null}
                        </>
                      }
                    />
                  </td>
                  <td className="tt-range">
                    <RangeBar pos={e.row.range_pos} low={e.row.range_low} high={e.row.range_high} />
                  </td>
                  <td className="tt-spark">
                    <Spark data={e.row.spark} up={e.row.delta >= 0} />
                  </td>
                  <td className="r num">{fmt(e.row.median_plat)}p</td>
                  <td className="r">
                    <Move delta={e.row.delta} z={e.row.z} />
                  </td>
                  <td className="r num muted" title="avg daily trade volume (liquidity)">
                    {fmt(e.row.volume)}/d
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>
                <span className="num">{fmt(view.length)}</span> signals ·{" "}
                <span className="num pos">{breadth.up}</span> up ·{" "}
                <span className="num neg">{breadth.down}</span> down ·{" "}
                <span className="num">{breadth.flat}</span> flat
              </td>
            </tr>
          </tfoot>
        </table>
        {hasMore ? (
          <button type="button" className="btn load-more" onClick={more}>
            Showing {shown} of {fmt(total)} — load more
          </button>
        ) : null}
      </div>

      {/* Category heat — the sector map */}
      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Category heat</h3>
        </div>
        {data.category_heat.map((h) => (
          <HeatRowView key={h.category} row={h} scale={heatScale} />
        ))}
      </div>
    </>
  );
}
