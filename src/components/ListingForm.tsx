import { useEffect, useMemo, useRef, useState } from "react";
import {
  useItemDetail,
  useItemOrders,
  useRecommendedPrice,
  useWfmCreateOrder,
  useWfmUpdateOrder,
} from "../hooks/queries";
import { useEscape } from "../hooks/useEscape";
import { clsx, fmt } from "../lib/format";
import { Glyph, Scrim } from "./ui";

/** When editing, the order is already posted: rank is fixed, only price/qty/visibility change. */
export interface ListingEdit {
  orderId: string;
  price: number | null;
  qty: number;
  visible: boolean;
}

/**
 * Create or edit a warframe.market sell order — a compact trading panel: live
 * market context (lowest ask / median / best bid / spread), one-click price
 * picks, quantity vs owned, and a live "position vs market" readout.
 */
export function ListingForm({
  slug,
  edit,
  initialRank,
  onClose,
}: {
  slug: string;
  edit?: ListingEdit;
  /** Preselect a rank in create mode (e.g. opened from a per-rank recommendation). */
  initialRank?: number;
  onClose: () => void;
}) {
  const { data: item } = useItemDetail(slug);
  const { data: orders } = useItemOrders(slug);
  // Closes whichever context opened it. When nested in the Drawer this fires
  // alongside the Drawer's guarded handler (both close just this form — harmless).
  useEscape(onClose);
  const create = useWfmCreateOrder();
  const update = useWfmUpdateOrder();
  const isEdit = edit != null;
  const ranked = !isEdit && item?.max_rank != null;

  const [price, setPrice] = useState<string>(edit?.price != null ? String(edit.price) : "");
  const [qty, setQty] = useState<string>(edit ? String(edit.qty) : "1");
  const [rank, setRank] = useState<number>(initialRank ?? 0);
  const [visible, setVisible] = useState<boolean>(edit?.visible ?? true);

  const ownedAtRank = useMemo(
    () => (r: number) => item?.ranks.find((x) => x.rank === r)?.qty ?? 0,
    [item],
  );
  // Median for the active context: rank-specific when ranked, else the headline.
  const medianFor = useMemo(
    () => (r: number) =>
      (ranked ? item?.ranks.find((x) => x.rank === r)?.median : null) ?? item?.median_plat ?? null,
    [item, ranked],
  );

  const lowestAsk = orders?.best_sell ?? null;
  const bestBid = orders?.best_buy ?? null;
  const median = medianFor(rank);
  const spread = lowestAsk != null && bestBid != null ? lowestAsk - bestBid : null;
  const owned = ranked ? ownedAtRank(rank) : (item?.owned_qty ?? 0);

  // Lowball-resistant recommended ask, computed in Rust from the robust order-book
  // low (median of cheapest 5) + the normal trade median — never chases a troll down.
  const { data: recommended } = useRecommendedPrice(slug, ranked ? rank : null);

  // Auto-fill the price with the recommended value until the user edits it (create
  // mode only). Resetting `touched` on a rank change lets the new rank's recommended
  // repopulate. `recommended` is keyed by (slug, rank) so it refetches per rank.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!isEdit && !touched && recommended != null) setPrice(String(recommended));
  }, [isEdit, touched, recommended]);

  // Prefill quantity to what's owned, once item data arrives (create mode only).
  const qtyPrefilled = useRef(false);
  useEffect(() => {
    if (isEdit || qtyPrefilled.current || !item) return;
    qtyPrefilled.current = true;
    if (owned > 0) setQty(String(owned));
  }, [isEdit, item, owned]);

  const editPrice = (v: string) => {
    setTouched(true);
    setPrice(v);
  };

  const onRankChange = (r: number) => {
    setRank(r);
    setTouched(false); // let the new rank's recommended repopulate the price
    const o = ownedAtRank(r);
    if (o > 0) setQty(String(o));
  };

  const p = Number.parseInt(price, 10);
  const q = Number.parseInt(qty, 10);
  const valid = Number.isFinite(p) && p > 0 && Number.isFinite(q) && q >= 1;
  const pending = create.isPending || update.isPending;
  const err = create.error ?? update.error;
  const total = valid ? p * q : null;

  // Position of the chosen price relative to the live lowest ask.
  let posNote: string | null = null;
  let posCls = "muted";
  if (Number.isFinite(p) && p > 0 && lowestAsk != null) {
    if (p < lowestAsk) {
      posNote = `undercuts lowest ask by ${fmt(lowestAsk - p)}p`;
      posCls = "pos";
    } else if (p === lowestAsk) {
      posNote = "matches lowest ask";
      posCls = "pos";
    } else {
      posNote = `${fmt(p - lowestAsk)}p over lowest ask`;
      posCls = "neg";
    }
  }

  const chips: { label: string; value: number }[] = [];
  if (recommended != null) chips.push({ label: `Best ${fmt(recommended)}`, value: recommended });
  if (lowestAsk != null) {
    chips.push({ label: `Match ${fmt(lowestAsk)}`, value: lowestAsk });
    if (lowestAsk > 1)
      chips.push({ label: `Undercut ${fmt(lowestAsk - 1)}`, value: lowestAsk - 1 });
  }
  if (median != null) chips.push({ label: `Median ${fmt(median)}`, value: median });

  const submit = () => {
    if (!valid) return;
    if (isEdit) {
      update.mutate(
        { orderId: edit.orderId, platinum: p, quantity: q, visible },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(
        { slug, platinum: p, quantity: q, rank: ranked ? rank : null, visible },
        { onSuccess: onClose },
      );
    }
  };

  return (
    <Scrim onClose={onClose}>
      <div className="modal lf-modal">
        <div className="modal-h">
          <h2>{isEdit ? "Edit listing" : "List for sale"}</h2>
          <span style={{ flex: 1 }} />
          <button type="button" className="x" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Item identity */}
        <div className="lf-head">
          <Glyph name={item?.display_name ?? slug} plat={median} thumb={item?.thumbnail_url} />
          <div className="lf-id">
            <span className="lf-name">{item?.display_name ?? "Loading…"}</span>
            <span className="lf-meta">
              {item ? `${item.part_type} · ${item.category}` : ""}
              {item && owned > 0 ? ` · own ×${owned}` : ""}
            </span>
          </div>
        </div>

        {/* Live market context */}
        <div className="dgrid lf-grid">
          <div className="cell">
            <div className="k">Lowest ask</div>
            <div className="v">{lowestAsk == null ? "—" : `${fmt(lowestAsk)}p`}</div>
          </div>
          <div className="cell">
            <div className="k">Median</div>
            <div className="v">{median == null ? "—" : `${fmt(median)}p`}</div>
          </div>
          <div className="cell">
            <div className="k">Best bid</div>
            <div className="v">{bestBid == null ? "—" : `${fmt(bestBid)}p`}</div>
          </div>
          <div className="cell">
            <div className="k">Spread</div>
            <div className="v">{spread == null ? "—" : `${fmt(spread)}p`}</div>
          </div>
          <div className="cell">
            <div className="k">Sellers · buyers</div>
            <div className="v">
              {orders ? `${fmt(orders.sellers)} · ${fmt(orders.buyers)}` : "—"}
            </div>
          </div>
          <div className="cell">
            <div className="k">You own</div>
            <div className="v">{owned > 0 ? `×${owned}` : "—"}</div>
          </div>
        </div>

        <div className="lf-body">
          {ranked && item ? (
            <div className="lf-row">
              <span className="lf-label">Rank</span>
              <select
                className="lf-select"
                value={rank}
                onChange={(e) => onRankChange(Number.parseInt(e.target.value, 10))}
              >
                {Array.from({ length: (item.max_rank ?? 0) + 1 }, (_, r) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: r IS the rank — a stable identity, not a position
                  <option key={r} value={r}>
                    Rank {r}
                    {r === 0 ? " (unranked)" : ""}
                    {r === item.max_rank ? " (max)" : ""}
                    {ownedAtRank(r) > 0 ? ` · own ×${ownedAtRank(r)}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Price */}
          <div className="lf-pricewrap">
            <div className="lf-label">Price · plat</div>
            <div className="lf-priceline">
              <input
                className="lf-price"
                type="number"
                min={1}
                value={price}
                onChange={(e) => editPrice(e.target.value)}
                autoFocus
              />
              <div className="lf-chips">
                {chips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className={clsx("chip", p === c.value && "on")}
                    onClick={() => editPrice(String(c.value))}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Quantity + visibility */}
          <div className="lf-row lf-qtyrow">
            <span className="lf-label">Qty</span>
            <input
              className="lf-qty"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            {owned > 0 ? (
              <>
                <span className="muted">/ {owned} owned</span>
                <button type="button" className="chip" onClick={() => setQty(String(owned))}>
                  Max
                </button>
              </>
            ) : null}
            <span style={{ flex: 1 }} />
            <label className="lf-check">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
              />
              <span>Visible</span>
            </label>
          </div>

          {/* Live summary */}
          <div className="lf-summary">
            {total != null ? (
              <>
                <span className="lf-total">
                  {fmt(q)} × {fmt(p)}p = <b>{fmt(total)}p</b>
                </span>
                {posNote ? <span className={clsx("lf-pos", posCls)}>· {posNote}</span> : null}
              </>
            ) : (
              <span className="muted">Enter a price and quantity.</span>
            )}
          </div>
        </div>

        <div className="modal-f">
          {err ? (
            <span className="muted neg" style={{ marginRight: 8 }}>
              {(err as Error).message}
            </span>
          ) : null}
          <span className="sp" style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn pri" onClick={submit} disabled={!valid || pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Post listing"}
          </button>
        </div>
      </div>
    </Scrim>
  );
}
