import { useEffect, useMemo, useState } from "react";
import { ItemTags } from "../components/ItemTags";
import { Chip, ItemName, SortTh, StatBox, TableStatus, rowAction } from "../components/ui";
import {
  useBudget,
  useBuyList,
  useListedSlugs,
  usePurchaseBuy,
  useRemoveBuy,
  useSetBudget,
  useSetBuyQty,
} from "../hooks/queries";
import { useColumnSort, usePaged } from "../hooks/useTable";
import { fmt, relativeDay } from "../lib/format";
import { usePersisted } from "../lib/persist";
import type { BuyRow } from "../lib/types";

const lineTotal = (r: BuyRow): number => (r.median_plat ?? 0) * r.buy_qty;

type BuyCol = "name" | "unit" | "qty" | "total" | "added";
const BUY_CMP: Record<BuyCol, (a: BuyRow, b: BuyRow) => number> = {
  name: (a, b) => a.display_name.localeCompare(b.display_name),
  unit: (a, b) => (a.median_plat ?? 0) - (b.median_plat ?? 0),
  qty: (a, b) => a.buy_qty - b.buy_qty,
  total: (a, b) => lineTotal(a) - lineTotal(b),
  added: (a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime(),
};

export function BuyList({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: rows = [], isLoading, isError } = useBuyList();
  const listed = useListedSlugs();
  const { data: budget } = useBudget();
  const setBudget = useSetBudget();
  const setQty = useSetBuyQty();
  const remove = useRemoveBuy();
  const purchase = usePurchaseBuy();
  const [vaulted, setVaulted] = usePersisted<"1" | "0">("wfit-buy-vault", "0");
  const [falling, setFalling] = usePersisted<"1" | "0">("wfit-buy-fall", "0");
  const [rising, setRising] = usePersisted<"1" | "0">("wfit-buy-rise", "0");
  const { sort, cycle, apply } = useColumnSort<BuyRow, BuyCol>("wfit-buy-sort", BUY_CMP);

  const [budgetInput, setBudgetInput] = useState<string>("");
  useEffect(() => {
    if (budget != null) setBudgetInput(String(budget));
  }, [budget]);

  const stats = useMemo(() => {
    const units = rows.reduce((s, r) => s + r.buy_qty, 0);
    const total = rows.reduce((s, r) => s + lineTotal(r), 0);
    const remaining = (budget ?? 0) - total;
    return { items: rows.length, units, total, remaining };
  }, [rows, budget]);

  const view = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (vaulted === "1" && !r.is_vaulted) return false;
      if (falling === "1" && r.trend !== "down") return false;
      if (rising === "1" && r.trend !== "up") return false;
      return true;
    });
    return apply(filtered);
  }, [rows, vaulted, falling, rising, apply]);
  const { visible, hasMore, shown, total, more } = usePaged(view, 60);

  const commitBudget = () => {
    const v = Number.parseInt(budgetInput, 10);
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

      <div className="mkt-filters" style={{ marginBottom: 12 }}>
        <Chip active={falling === "1"} onClick={() => setFalling(falling === "1" ? "0" : "1")}>
          Trending down
        </Chip>
        <Chip active={rising === "1"} onClick={() => setRising(rising === "1" ? "0" : "1")}>
          Trending up
        </Chip>
        <Chip active={vaulted === "1"} onClick={() => setVaulted(vaulted === "1" ? "0" : "1")}>
          Vaulted
        </Chip>
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
            onClick={() => {
              for (const r of rows) purchase.mutate(r.slug);
            }}
          >
            Purchase all → inventory
          </button>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <SortTh<BuyCol> label="Item" col="name" sort={sort} onSort={cycle} />
              <SortTh<BuyCol> label="Unit price" col="unit" sort={sort} onSort={cycle} right />
              <SortTh<BuyCol> label="Qty" col="qty" sort={sort} onSort={cycle} right />
              <SortTh<BuyCol> label="Line total" col="total" sort={sort} onSort={cycle} right />
              <SortTh<BuyCol> label="Added" col="added" sort={sort} onSort={cycle} right />
              <th className="r">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || visible.length === 0 ? (
              <TableStatus
                span={6}
                loading={isLoading}
                error={isError}
                emptyText="Buy list is empty — add from Sets, Watchlist, or the Drawer."
              />
            ) : (
              visible.map((r) => (
                <tr key={r.slug} {...rowAction(() => onOpen(r.slug))}>
                  <td>
                    <ItemName
                      name={r.display_name}
                      plat={r.median_plat}
                      thumb={r.thumbnail_url}
                      sub={r.part_type}
                      tags={
                        <ItemTags
                          trend={r.trend}
                          vaulted={r.is_vaulted}
                          listed={listed.has(r.slug)}
                        />
                      }
                    />
                  </td>
                  <td className="r">{fmt(r.median_plat)}p</td>
                  <td
                    className="r"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <span className="qstep" style={{ display: "inline-flex" }}>
                      <button
                        type="button"
                        onClick={() => setQty.mutate({ slug: r.slug, qty: r.buy_qty - 1 })}
                      >
                        −
                      </button>
                      <span className="qn">{r.buy_qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty.mutate({ slug: r.slug, qty: r.buy_qty + 1 })}
                      >
                        +
                      </button>
                    </span>
                  </td>
                  <td className="r">{fmt(lineTotal(r))}p</td>
                  <td className="r muted">{relativeDay(r.added_at)}</td>
                  <td
                    className="r"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => purchase.mutate(r.slug)}
                    >
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
        {hasMore ? (
          <button type="button" className="btn load-more" onClick={more}>
            Showing {shown} of {fmt(total)} — load more
          </button>
        ) : null}
      </div>
    </>
  );
}
