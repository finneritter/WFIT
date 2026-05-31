import { useMemo, useState } from "react";
import {
  useAddToBuyList,
  useAddWatch,
  useItemDetail,
  useItemOrders,
  useRecordSale,
} from "../hooks/queries";
import { clsx, fmt, pct, tier } from "../lib/format";
import type { HistoryPoint } from "../lib/types";
import { type Candle, CandleChart } from "./charts";

const TF = ["24h", "7d", "30d", "90d"] as const;
const TF_DAYS: Record<string, number> = { "24h": 2, "7d": 7, "30d": 30, "90d": 90 };

/** A history row → candle, falling back to the median when OHLC is absent
 *  (older cached rows pre-date OHLC capture and draw as flat ticks). */
function toCandle(h: HistoryPoint): Candle | null {
  const close = h.close ?? h.median;
  if (close == null) return null;
  const open = h.open ?? close;
  return {
    o: open,
    c: close,
    h: h.high ?? Math.max(open, close),
    l: h.low ?? Math.min(open, close),
    v: h.volume ?? 0,
  };
}

export function Drawer({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { data: item } = useItemDetail(slug);
  const { data: orders } = useItemOrders(slug);
  const [tf, setTf] = useState<(typeof TF)[number]>("90d");
  const sell = useRecordSale();
  const watch = useAddWatch();
  const buy = useAddToBuyList();

  const candles = useMemo(() => {
    if (!item) return [];
    return item.history
      .slice(-TF_DAYS[tf])
      .map(toCandle)
      .filter((c): c is Candle => c != null);
  }, [item, tf]);

  const stats = useMemo(() => {
    if (candles.length === 0) return null;
    const hi = Math.max(...candles.map((c) => c.h));
    const lo = Math.min(...candles.map((c) => c.l));
    const cur = candles[candles.length - 1].c;
    const rangePos = hi > lo ? (cur - lo) / (hi - lo) : 0.5;
    const avgVol = candles.reduce((s, c) => s + c.v, 0) / candles.length;
    return { hi, lo, rangePos, avgVol };
  }, [candles]);

  if (!item) {
    return (
      <div className="scrim" onClick={onClose}>
        <div className="drawer" onClick={(e) => e.stopPropagation()}>
          <div className="drawer-h">
            <div className="di">
              <div className="nm">Loading…</div>
            </div>
            <button type="button" className="x" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
      </div>
    );
  }

  const owned = item.owned_qty > 0;
  const delta = item.delta_7d ?? 0;
  const price = item.median_plat;
  const stack = price != null ? price * item.owned_qty : null;

  const spread =
    orders?.best_buy != null && orders?.best_sell != null
      ? orders.best_sell - orders.best_buy
      : null;
  const dPerPlat = item.ducats != null && price ? item.ducats / price : null;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-h">
          <div className={clsx("ph", `t-${tier(price)}`)} />
          <div className="di">
            <div className="nm">{item.display_name}</div>
            <div className="sub">
              {item.part_type} · {item.category}
            </div>
          </div>
          <button type="button" className="x" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="price-row">
          <div className="big num">
            {fmt(price)}
            <span className="u"> p</span>
          </div>
          <div className={clsx("num", delta >= 0 ? "pos" : "neg")}>{pct(delta)}</div>
        </div>
        <div className="price-sub">
          {item.trend ? `trend ${item.trend}` : "no recent trend"} · synced from warframe.market
        </div>

        <div className="chart">
          <div className="chart-tf">
            {TF.map((t) => (
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
            <span className="malegend">
              <i className="ma7" /> MA7 <i className="ma30" /> MA30
            </span>
          </div>
          <CandleChart candles={candles} />
        </div>

        <div className="dgrid">
          <div className="cell">
            <div className="k">{tf} high · low</div>
            <div className="v num">{stats ? `${fmt(stats.hi)} · ${fmt(stats.lo)}` : "—"}</div>
          </div>
          <div className="cell">
            <div className="k">Range position</div>
            <div className="v num">{stats ? `${Math.round(stats.rangePos * 100)}%` : "—"}</div>
          </div>
          <div className="cell">
            <div className="k">Avg volume</div>
            <div className="v num">{stats ? `${fmt(stats.avgVol)}/day` : "—"}</div>
          </div>
          <div className="cell">
            <div className="k">Spread (live)</div>
            <div className="v num">
              {spread == null ? (
                <span className="muted">—</span>
              ) : (
                <>
                  {fmt(spread)}p
                  <span className="u">
                    {" "}
                    {fmt(orders?.best_buy)}→{fmt(orders?.best_sell)}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="cell">
            <div className="k">Ducats</div>
            <div className="v num">
              {item.ducats == null ? (
                <span className="muted">—</span>
              ) : (
                <>
                  {fmt(item.ducats)}
                  {dPerPlat != null ? (
                    <span className={clsx("u", dPerPlat >= 10 ? "pos" : "")}>
                      {" "}
                      {dPerPlat.toFixed(1)} d/p · {dPerPlat >= 10 ? "ducat it" : "sell for plat"}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>
          <div className="cell">
            <div className="k">Sellers · buyers</div>
            <div className="v num">
              {orders ? `${fmt(orders.sellers)} · ${fmt(orders.buyers)}` : "—"}
            </div>
          </div>
          <div className="cell">
            <div className="k">You own · stack</div>
            <div className="v num">
              ×{item.owned_qty}
              {stack != null ? <span className="u"> · {fmt(stack)}p</span> : null}
            </div>
          </div>
          <div className="cell">
            <div className="k">Realized (sold)</div>
            <div className="v num">
              {item.sold_qty > 0 ? (
                <>
                  {fmt(item.realized_plat)}p<span className="u"> · ×{item.sold_qty}</span>
                </>
              ) : (
                <span className="muted">none</span>
              )}
            </div>
          </div>
        </div>

        <div className="drawer-actions">
          {owned ? (
            <>
              <button
                type="button"
                className="btn pri"
                onClick={() => sell.mutate({ slug: item.slug })}
              >
                Sell 1 · {fmt(price)}p
              </button>
              <button type="button" className="btn" disabled title="Order management is v1-deferred">
                {item.listed ? "Listed" : "List on market"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn pri"
              onClick={() => buy.mutate({ slug: item.slug })}
            >
              Add to buy list
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={item.on_watchlist}
            onClick={() =>
              watch.mutate({
                slug: item.slug,
                target: price != null ? Math.round(price * 0.9) : undefined,
              })
            }
          >
            {item.on_watchlist ? "On watchlist" : "Add to watchlist"}
          </button>
        </div>
      </div>
    </div>
  );
}
