import { useMemo, useState } from "react";
import {
  useAddToBuyList,
  useAddWatch,
  useItemDetail,
  useRecordSale,
} from "../hooks/queries";
import { clsx, fmt, pct, tier } from "../lib/format";
import { BigChart } from "./charts";

const TF = ["24h", "7d", "30d", "90d"] as const;
const TF_DAYS: Record<string, number> = { "24h": 2, "7d": 7, "30d": 30, "90d": 90 };

export function Drawer({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { data: item } = useItemDetail(slug);
  const [tf, setTf] = useState<(typeof TF)[number]>("90d");
  const sell = useRecordSale();
  const watch = useAddWatch();
  const buy = useAddToBuyList();

  const series = useMemo(() => {
    if (!item) return [];
    const days = TF_DAYS[tf];
    return item.history
      .slice(-days)
      .map((h) => h.median)
      .filter((m): m is number => m != null);
  }, [item, tf]);

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
  const lo = price != null ? Math.round(price * 0.82) : null;
  const hi = price != null ? Math.round(price * 1.15) : null;

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
          </div>
          <BigChart data={series} />
        </div>

        <div className="dgrid">
          <div className="cell">
            <div className="k">You own</div>
            <div className="v num">×{item.owned_qty}</div>
          </div>
          <div className="cell">
            <div className="k">Ducat value</div>
            <div className="v num">{item.ducats == null ? "—" : fmt(item.ducats)}</div>
          </div>
          <div className="cell">
            <div className="k">7d range</div>
            <div className="v num">
              {lo == null ? "—" : `${fmt(lo)}–${fmt(hi)}`}
            </div>
          </div>
          <div className="cell">
            <div className="k">Stack value</div>
            <div className="v num">{stack == null ? "—" : `${fmt(stack)}p`}</div>
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
