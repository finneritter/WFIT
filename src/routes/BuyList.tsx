import { useEffect, useMemo, useState } from "react";
import { Glyph, StatBox } from "../components/ui";
import {
  useBudget,
  useBuyList,
  usePurchaseBuy,
  useRemoveBuy,
  useSetBudget,
  useSetBuyQty,
} from "../hooks/queries";
import { fmt } from "../lib/format";

export function BuyList({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: rows = [], isLoading } = useBuyList();
  const { data: budget } = useBudget();
  const setBudget = useSetBudget();
  const setQty = useSetBuyQty();
  const remove = useRemoveBuy();
  const purchase = usePurchaseBuy();

  const [budgetInput, setBudgetInput] = useState<string>("");
  useEffect(() => {
    if (budget != null) setBudgetInput(String(budget));
  }, [budget]);

  const stats = useMemo(() => {
    const units = rows.reduce((s, r) => s + r.buy_qty, 0);
    const total = rows.reduce((s, r) => s + (r.median_plat ?? 0) * r.buy_qty, 0);
    const remaining = (budget ?? 0) - total;
    return { items: rows.length, units, total, remaining };
  }, [rows, budget]);

  const commitBudget = () => {
    const v = parseInt(budgetInput, 10);
    if (!Number.isNaN(v)) setBudget.mutate(v);
  };

  return (
    <>
      <div className="statband" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <StatBox k="Items" v={fmt(stats.items)} />
        <StatBox k="Units" v={fmt(stats.units)} />
        <StatBox k="Total cost" v={fmt(stats.total)} unit="p" />
        <StatBox
          k="Remaining budget"
          v={fmt(stats.remaining)}
          unit="p"
          dcls={stats.remaining < 0 ? "neg" : "muted"}
        />
      </div>

      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Buy list</h3>
          <span className="sp" style={{ flex: 1 }} />
          <span className="budget">
            <input
              type="number"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              onBlur={commitBudget}
              placeholder="budget"
            />
            <span className="u">p</span>
          </span>
          <button
            type="button"
            className="btn sm"
            style={{ marginLeft: 8 }}
            onClick={() => rows.forEach((r) => purchase.mutate(r.slug))}
          >
            Purchase all → inventory
          </button>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Unit price</th>
              <th className="r">Qty</th>
              <th className="r">Line total</th>
              <th className="r">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="muted">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  Buy list is empty — add from Sets, Watchlist, or the Drawer.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.slug} onClick={() => onOpen(r.slug)}>
                  <td>
                    <div className="dnm">
                      <Glyph name={r.display_name} plat={r.median_plat} />
                      <div className="di">
                        <span className="nm">{r.display_name}</span>
                        <span className="sub">{r.part_type}</span>
                      </div>
                    </div>
                  </td>
                  <td className="r">{fmt(r.median_plat)}p</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <span className="qstep" style={{ display: "inline-flex" }}>
                      <button type="button" onClick={() => setQty.mutate({ slug: r.slug, qty: r.buy_qty - 1 })}>
                        −
                      </button>
                      <span className="qn">{r.buy_qty}</span>
                      <button type="button" onClick={() => setQty.mutate({ slug: r.slug, qty: r.buy_qty + 1 })}>
                        +
                      </button>
                    </span>
                  </td>
                  <td className="r">{fmt((r.median_plat ?? 0) * r.buy_qty)}p</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn sm" onClick={() => purchase.mutate(r.slug)}>
                      Bought
                    </button>{" "}
                    <button type="button" className="rm" onClick={() => remove.mutate(r.slug)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
