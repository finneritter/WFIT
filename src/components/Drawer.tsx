import { useMemo, useRef, useState } from "react";
import {
  useAddToBuyList,
  useAddWatch,
  useItemDetail,
  useItemOrders,
  useRecordSale,
  useRemoveItem,
  useWfmAccount,
} from "../hooks/queries";
import { useEscape } from "../hooks/useEscape";
import { clsx, fmt, pct, tier } from "../lib/format";
import type { HistoryPoint } from "../lib/types";
import { openWiki } from "../lib/wiki";
import { ListingForm } from "./ListingForm";
import { type Candle, CandleChart } from "./charts";
import { Scrim } from "./ui";

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

export function Drawer({
  slug,
  onClose,
  onGoListings,
}: {
  slug: string;
  onClose: () => void;
  // Navigate to the Listings screen (and close the drawer) so the user can
  // connect a session — drives the "Connect to list" CTA when none exists yet.
  onGoListings?: () => void;
}) {
  const { data: item, isError } = useItemDetail(slug);
  const { data: orders } = useItemOrders(slug);
  const { data: account } = useWfmAccount();
  const [tf, setTf] = useState<(typeof TF)[number]>("90d");
  const [listing, setListing] = useState(false);
  const sell = useRecordSale();
  const watch = useAddWatch();
  const buy = useAddToBuyList();
  const remove = useRemoveItem();
  // Route Escape to the topmost layer: when the nested listing form is open,
  // close that (matching the form's own handler); otherwise close the drawer.
  // The guard is what keeps the drawer from closing out from under an open form.
  useEscape(listing ? () => setListing(false) : onClose);

  // Resizable width — drag the grip on the drawer's left edge; remembered.
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("wfit.drawerWidth"));
    return Number.isFinite(saved) && saved >= 360 ? saved : 440;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(Math.max(window.innerWidth - ev.clientX, 360), window.innerWidth - 80);
      widthRef.current = w;
      setWidth(w);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      try {
        localStorage.setItem("wfit.drawerWidth", String(Math.round(widthRef.current)));
      } catch {
        // ignore persistence failures
      }
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const grip = (
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only resize affordance (no keyboard equivalent)
    <div
      className="drawer-grip"
      style={{ right: width }}
      onPointerDown={startResize}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize"
    />
  );

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
      <Scrim className="scrim" onClose={onClose}>
        {grip}
        <div className="drawer" style={{ width }}>
          <div className="drawer-h">
            <div className="di">
              <div className="nm">{isError ? "Couldn't load this item." : "Loading…"}</div>
            </div>
            <button type="button" className="x" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
      </Scrim>
    );
  }

  const owned = item.owned_qty > 0;
  const delta = item.delta_7d;
  const price = item.median_plat;
  // Mods/arcanes carry a rank-aware stack value; otherwise median × owned.
  const stack = item.value_plat ?? (price != null ? price * item.owned_qty : null);

  const spread =
    orders?.best_buy != null && orders?.best_sell != null
      ? orders.best_sell - orders.best_buy
      : null;
  const dPerPlat = item.ducats != null && price ? item.ducats / price : null;

  return (
    <Scrim className="scrim" onClose={onClose}>
      {grip}
      <div className="drawer" style={{ width }}>
        <div className="drawer-h">
          <div className={clsx("ph", `t-${tier(price)}`)}>
            {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" /> : null}
          </div>
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
          <div className={clsx("num", delta == null ? "muted" : delta >= 0 ? "pos" : "neg")}>
            {delta == null ? "—" : pct(delta)}
          </div>
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
            <div className="k">You own · at market</div>
            <div className="v num">
              ×{item.owned_qty}
              {stack != null ? <span className="u"> · {fmt(stack)}p</span> : null}
            </div>
          </div>
          {item.realizable_plat != null && item.owned_qty > 0 ? (
            <div className="cell">
              <div className="k">Realizable · if sold gradually</div>
              <div className="v num">
                {fmt(item.realizable_plat)}p
                {item.liquidity != null ? (
                  <span className="u"> · {Math.round(item.liquidity * 100)}% liq</span>
                ) : null}
                {item.days_to_sell != null ? (
                  <span className="u"> · ~{fmt(item.days_to_sell)}d to sell</span>
                ) : null}
              </div>
            </div>
          ) : null}
          {item.confidence ? (
            <div className="cell">
              <div className="k">Confidence · basis</div>
              <div className="v num">
                <span className={clsx("cf-tag", item.confidence)}>{item.confidence}</span>
                {item.volume_7d != null ? (
                  <span className="u"> · {fmt(item.volume_7d)} trades/wk</span>
                ) : null}
              </div>
            </div>
          ) : null}
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

        {item.ranks.length > 0 ? (
          <div className="rankbox">
            <div className="rankbox-h">
              Owned by rank{item.max_rank != null ? ` (max ${item.max_rank})` : ""}
            </div>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th className="r">Qty</th>
                  <th className="r">Price</th>
                  <th className="r">Value</th>
                </tr>
              </thead>
              <tbody>
                {item.ranks.map((rk) => (
                  <tr key={rk.rank}>
                    <td>
                      Rank {rk.rank}
                      {item.max_rank != null && rk.rank === item.max_rank ? (
                        <span className="muted"> · max</span>
                      ) : null}
                    </td>
                    <td className="r num">×{rk.qty}</td>
                    <td className="r num">{rk.median != null ? `${fmt(rk.median)}p` : "—"}</td>
                    <td className="r num">
                      {rk.median != null ? `${fmt(rk.median * rk.qty)}p` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

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
              {account?.has_session ? (
                <button
                  type="button"
                  className="btn"
                  title="Post a sell order on warframe.market"
                  onClick={() => setListing(true)}
                >
                  List for sale
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  title="Connect a warframe.market session on the Listings screen to post orders"
                  onClick={() => onGoListings?.()}
                >
                  Connect to list →
                </button>
              )}
              <button
                type="button"
                className="btn warn"
                title="Remove this item from your inventory"
                onClick={() => {
                  remove.mutate(item.slug);
                  onClose();
                }}
              >
                Remove
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
          <button
            type="button"
            className="btn"
            title="Open this item's wiki page in an in-app window"
            onClick={() => openWiki(item.display_name)}
          >
            Wiki ↗
          </button>
        </div>
      </div>
      {listing ? <ListingForm slug={item.slug} onClose={() => setListing(false)} /> : null}
    </Scrim>
  );
}
