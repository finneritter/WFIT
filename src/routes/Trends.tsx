import { useState } from "react";
import { MiniArea, RangeBar, Spark } from "../components/charts";
import { BlockStatus, Glyph } from "../components/ui";
import { useTrends } from "../hooks/queries";
import { CATEGORY_LABELS, clsx, fmt, pct } from "../lib/format";
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

function SignalRow({
  row,
  mode,
  onOpen,
}: {
  row: TrendRow;
  mode: "sell" | "buy" | "unusual";
  onOpen: (s: string) => void;
}) {
  return (
    <button type="button" className="sigrow" onClick={() => onOpen(row.slug)}>
      <Glyph name={row.display_name} plat={row.median_plat} thumb={row.thumbnail_url} />
      <span className="si">
        <span className="sn">
          {row.display_name}
          {mode === "sell" && row.owned_qty > 0 ? <i className="own">×{row.owned_qty}</i> : null}
          {mode !== "sell" && row.on_watchlist ? <i className="star">★</i> : null}
        </span>
        <RangeBar pos={row.range_pos} low={row.range_low} high={row.range_high} />
      </span>
      <Spark data={row.spark} up={row.delta >= 0} />
      <span className="sr">
        <span className="sp num">{fmt(row.median_plat)}p</span>
        <Move delta={row.delta} z={row.z} />
      </span>
    </button>
  );
}

function Panel({
  title,
  note,
  rows,
  mode,
  empty,
  onOpen,
}: {
  title: string;
  note?: string;
  rows: TrendRow[];
  mode: "sell" | "buy" | "unusual";
  empty: string;
  onOpen: (s: string) => void;
}) {
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>{title}</h3>
        {note ? <span className="meta">{note}</span> : null}
      </div>
      {rows.length === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        rows.map((r) => <SignalRow key={r.slug} row={r} mode={mode} onOpen={onOpen} />)
      )}
    </div>
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
  const [tf, setTf] = useState<(typeof TFS)[number]>("7d");
  const [excludeOutliers, setExcludeOutliers] = useState(true);
  const { data, isLoading, isError } = useTrends(tf, excludeOutliers);

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

      {/* Signal controls */}
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
        <button
          type="button"
          className="chip"
          aria-pressed={excludeOutliers}
          title="Clamp troll/fat-finger price prints so they don't skew the index or signals"
          onClick={() => setExcludeOutliers((v) => !v)}
        >
          Exclude outliers
        </button>
      </div>

      {/* Row 2 — decision panels */}
      <div className="tgrid trow2">
        <Panel
          title="Sell signals"
          note="you own these"
          rows={data.sell_signals}
          mode="sell"
          empty="Items you own that are high in their range or spiking will surface here."
          onOpen={onOpen}
        />
        <Panel
          title="Buy / flip candidates"
          note="low in range"
          rows={data.buy_candidates}
          mode="buy"
          empty="No clear dips in liquid items right now."
          onOpen={onOpen}
        />
      </div>

      {/* Row 3 — context */}
      <div className="tgrid trow2">
        <Panel
          title="Unusual moves"
          note="volatility-adjusted"
          rows={data.unusual}
          mode="unusual"
          empty="Nothing moving unusually."
          onOpen={onOpen}
        />
        <div className="tpanel">
          <div className="tpanel-h">
            <h3>Category heat</h3>
          </div>
          {data.category_heat.map((h) => (
            <HeatRowView key={h.category} row={h} scale={heatScale} />
          ))}
        </div>
      </div>
    </>
  );
}
