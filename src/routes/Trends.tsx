import { useState } from "react";
import { MiniArea, Spark } from "../components/charts";
import { Glyph } from "../components/ui";
import { useTrends } from "../hooks/queries";
import { CATEGORY_LABELS, clsx, fmt, pct } from "../lib/format";
import type { HeatRow, ImpactRow, MoverRow, VolRow } from "../lib/types";

const TFS = ["24h", "7d", "30d", "90d"] as const;

function MoverRowView({ row, rank, onOpen }: { row: MoverRow; rank: number; onOpen: (s: string) => void }) {
  return (
    <button type="button" className="mrow mover" onClick={() => onOpen(row.slug)}>
      <span className="rk">{rank}</span>
      <Glyph name={row.display_name} plat={row.median_plat} />
      <span className="mi">
        <span className="mn">{row.display_name}</span>
        <span className="ms">{row.part_type}</span>
      </span>
      <Spark data={row.spark} />
      <span className="mp num">{fmt(row.median_plat)}p</span>
      <span className={clsx("md num", row.delta >= 0 ? "pos" : "neg")}>{pct(row.delta)}</span>
    </button>
  );
}

function VolRowView({ row, rank, max, onOpen }: { row: VolRow; rank: number; max: number; onOpen: (s: string) => void }) {
  return (
    <button type="button" className="mrow vol" onClick={() => onOpen(row.slug)}>
      <span className="rk">{rank}</span>
      <Glyph name={row.display_name} plat={row.median_plat} />
      <span className="mi">
        <span className="mn">{row.display_name}</span>
        <span className="ms">{row.part_type}</span>
      </span>
      <span className="vbar2">
        <i style={{ width: `${max ? Math.round((row.volume / max) * 100) : 0}%` }} />
      </span>
      <span className="vnum">{fmt(row.volume)}/wk</span>
    </button>
  );
}

function ImpactRowView({ row, onOpen }: { row: ImpactRow; onOpen: (s: string) => void }) {
  return (
    <button type="button" className="mrow imp" onClick={() => onOpen(row.slug)}>
      <Glyph name={row.display_name} plat={null} />
      <span className="mi">
        <span className="mn">{row.display_name}</span>
        <span className="ms">{CATEGORY_LABELS[row.category]}</span>
      </span>
      <span className="own">{row.category}</span>
      <span className={clsx("impv", row.impact >= 0 ? "pos" : "neg")}>
        {row.impact >= 0 ? "+" : ""}
        {fmt(row.impact)}p
      </span>
    </button>
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

  const maxVol = Math.max(1, ...data.most_traded.map((v) => v.volume));
  const heatScale = Math.max(1, ...data.category_heat.map((h) => Math.abs(h.avg_delta)));

  return (
    <>
      <div className="tf-row">
        <span className="lbl">timeframe</span>
        {TFS.map((t) => (
          <button key={t} type="button" className="chip" aria-pressed={tf === t} onClick={() => setTf(t)}>
            {t}
          </button>
        ))}
        <span className="sp" />
        <span className="note">priced subset only — drains in background</span>
      </div>

      <div className="tgrid trow-idx">
        <div className="tpanel">
          <div className="tpanel-h">
            <h3>Prime Market Index</h3>
            <span className="meta">{tf}</span>
          </div>
          <div className="idx">
            <span className="lvl num">{fmt(data.index_level)}</span>
            <span className={clsx("chg num", data.index_change >= 0 ? "pos" : "neg")}>
              {pct(data.index_change)}
            </span>
          </div>
          <div className="idx-sub">
            <span>
              advancing <b className="up">{data.advancing}</b>
            </span>
            <span>
              declining <b className="dn">{data.declining}</b>
            </span>
            <span>
              flat <b>{data.flat}</b>
            </span>
          </div>
          <div className="idx-chart">
            <MiniArea data={data.index_spark} w={520} h={70} />
          </div>
        </div>

        <div className="tpanel">
          <div className="tpanel-h">
            <h3>Category heat</h3>
          </div>
          {data.category_heat.map((h) => (
            <HeatRowView key={h.category} row={h} scale={heatScale} />
          ))}
        </div>
      </div>

      <div className="tgrid trow2">
        <div className="tpanel">
          <div className="tpanel-h">
            <h3>Top gainers</h3>
          </div>
          {data.gainers.map((m, i) => (
            <MoverRowView key={m.slug} row={m} rank={i + 1} onOpen={onOpen} />
          ))}
        </div>
        <div className="tpanel">
          <div className="tpanel-h">
            <h3>Top losers</h3>
          </div>
          {data.losers.map((m, i) => (
            <MoverRowView key={m.slug} row={m} rank={i + 1} onOpen={onOpen} />
          ))}
        </div>
      </div>

      <div className="tgrid trow2">
        <div className="tpanel">
          <div className="tpanel-h">
            <h3>Most traded</h3>
          </div>
          {data.most_traded.map((v, i) => (
            <VolRowView key={v.slug} row={v} rank={i + 1} max={maxVol} onOpen={onOpen} />
          ))}
        </div>
        <div className="tpanel">
          <div className="tpanel-h">
            <h3>Your inventory in motion</h3>
          </div>
          {data.inventory_motion.length === 0 ? (
            <div className="empty">Own some priced items to see their market impact.</div>
          ) : (
            data.inventory_motion.map((m) => <ImpactRowView key={m.slug} row={m} onOpen={onOpen} />)
          )}
        </div>
      </div>
    </>
  );
}
