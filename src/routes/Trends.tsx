import { useState } from "react";
import { MiniArea, RangeBar, Spark } from "../components/charts";
import { Glyph } from "../components/ui";
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
      <Glyph name={row.display_name} plat={row.median_plat} />
      <span className="si">
        <span className="sn">
          {row.display_name}
          {mode === "sell" && row.owned_qty > 0 ? <i className="own">×{row.owned_qty}</i> : null}
          {mode !== "sell" && row.on_watchlist ? <i className="star">★</i> : null}
        </span>
        <RangeBar pos={row.range_pos} low={row.range_low} high={row.range_high} />
      </span>
      <Spark data={row.spark} />
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
  const { data, isLoading } = useTrends(tf);

  if (isLoading || !data) return <div className="empty">Loading market trends…</div>;

  const heatScale = Math.max(1, ...data.category_heat.map((h) => Math.abs(h.avg_delta)));

  return (
    <>
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
        <span className="note">
          signals from {fmt(data.liquid_count)} liquid of {fmt(data.total_priced)} priced items
        </span>
      </div>

      {/* Row 1 — market read + your holdings */}
      <div className="tgrid trow-band">
        <div className="tpanel band">
          <div className="tpanel-h">
            <h3>Prime market</h3>
            <span className="meta">{tf}</span>
          </div>
          <div className="bandtop">
            <span className={clsx("bandchg num", data.index_change >= 0 ? "pos" : "neg")}>
              {pct(data.index_change)}
            </span>
            <span className="breadth">
              <b className="up">{data.advancing}</b> up · <b className="dn">{data.declining}</b>{" "}
              down · <b>{data.flat}</b> flat
            </span>
            <span className="bandspark">
              <MiniArea data={data.index_spark} w={240} h={34} />
            </span>
          </div>
        </div>

        <div className="tpanel band">
          <div className="tpanel-h">
            <h3>Your holdings</h3>
            <span className="meta">{tf}</span>
          </div>
          {data.holdings_value > 0 ? (
            <div className="bandtop">
              <span className="bandval num">{fmt(data.holdings_value)}p</span>
              <span className={clsx("bandchg num", data.holdings_change >= 0 ? "pos" : "neg")}>
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
