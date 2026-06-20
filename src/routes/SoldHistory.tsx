import { useMemo } from "react";
import { Chip, ItemName, SortTh, StatBox, TableStatus, rowAction } from "../components/ui";
import { useSales, useUndoSale } from "../hooks/queries";
import { useColumnSort, usePaged } from "../hooks/useTable";
import { CATEGORY_LABELS, clsx, fmt, lineTotal, pct, relativeDay } from "../lib/format";
import { usePersisted } from "../lib/persist";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { soldSchema } from "../lib/searchSchemas";
import type { Category, SaleRow } from "../lib/types";

// How the realized unit price compared to the market median *at the time of sale*
// (captured on every sale, surfaced here): + = beat the market, − = sold under it.
const vsMedian = (r: SaleRow): number | null =>
  r.market_median_at_sale_time && r.market_median_at_sale_time > 0 && r.plat_per_unit != null
    ? ((r.plat_per_unit - r.market_median_at_sale_time) / r.market_median_at_sale_time) * 100
    : null;
const saleTotal = (r: SaleRow): number => lineTotal(r.plat_per_unit, r.qty);

type SoldCol = "when" | "name" | "vsmedian" | "qty" | "unit" | "total";
const SOLD_CMP: Record<SoldCol, (a: SaleRow, b: SaleRow) => number> = {
  when: (a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime(),
  name: (a, b) => a.display_name.localeCompare(b.display_name),
  vsmedian: (a, b) =>
    (vsMedian(a) ?? Number.NEGATIVE_INFINITY) - (vsMedian(b) ?? Number.NEGATIVE_INFINITY),
  qty: (a, b) => a.qty - b.qty,
  unit: (a, b) => (a.plat_per_unit ?? 0) - (b.plat_per_unit ?? 0),
  total: (a, b) => saleTotal(a) - saleTotal(b),
};

export function SoldHistory({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: rows = [], isLoading, isError } = useSales();
  const undo = useUndoSale();
  const [cat, setCat] = usePersisted<string>("wfit-sold-cat", "all");
  const { sort, cycle, apply } = useColumnSort<SaleRow, SoldCol>("wfit-sold-sort", SOLD_CMP, {
    key: "when",
    dir: "desc",
  });

  const stats = useMemo(() => {
    const now = Date.now();
    const within = (days: number, r: SaleRow) =>
      now - new Date(r.sold_at).getTime() <= days * 86_400_000;
    const total = (rs: SaleRow[]) => rs.reduce((s, r) => s + (r.plat_per_unit ?? 0) * r.qty, 0);
    const e7 = total(rows.filter((r) => within(7, r)));
    const e30 = total(rows.filter((r) => within(30, r)));
    const units = rows.reduce((s, r) => s + r.qty, 0);
    const totalPlat = total(rows);
    const avg = units ? Math.round(totalPlat / units) : 0;
    const best = rows.reduce((m, r) => Math.max(m, r.plat_per_unit ?? 0), 0);
    return { e7, e30, units, avg, best };
  }, [rows]);

  // Categories actually present, for the filter chips.
  const cats = useMemo(() => {
    const set = new Set(rows.map((r) => r.category));
    return (["warframe", "weapon", "set", "mod", "arcane"] as Category[]).filter((c) => set.has(c));
  }, [rows]);

  const search = usePageSearch();
  const { test } = useMemo(() => compileQuery(search, soldSchema), [search]);
  const view = useMemo(
    () => apply(rows.filter((r) => (cat === "all" || r.category === cat) && test(r))),
    [rows, cat, test, apply],
  );
  const { visible, hasMore, shown, total, more } = usePaged(
    view,
    60,
    `${cat}|${search}|${sort ? sort.key + sort.dir : ""}`,
  );

  const isToday = (iso: string) => relativeDay(iso) === "today";

  return (
    <>
      <div className="statband">
        <StatBox k="Earned · 7d" v={fmt(stats.e7)} unit="p" dcls="pos" />
        <StatBox k="Earned · 30d" v={fmt(stats.e30)} unit="p" />
        <StatBox k="Units sold" v={fmt(stats.units)} />
        <StatBox k="Avg sale" v={fmt(stats.avg)} unit="p" />
        <StatBox k="Best sale" v={fmt(stats.best)} unit="p" />
      </div>

      {cats.length > 1 ? (
        <div className="mkt-filters">
          <Chip active={cat === "all"} onClick={() => setCat("all")}>
            All
          </Chip>
          {cats.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
              {CATEGORY_LABELS[c]}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="tpanel">
        <table className="dtable">
          <thead>
            <tr>
              <SortTh<SoldCol> label="When" col="when" sort={sort} onSort={cycle} />
              <SortTh<SoldCol> label="Item" col="name" sort={sort} onSort={cycle} />
              <SortTh<SoldCol> label="vs median" col="vsmedian" sort={sort} onSort={cycle} right />
              <SortTh<SoldCol> label="Qty" col="qty" sort={sort} onSort={cycle} right />
              <SortTh<SoldCol> label="Unit" col="unit" sort={sort} onSort={cycle} right />
              <SortTh<SoldCol> label="Total" col="total" sort={sort} onSort={cycle} right />
              <th className="r" />
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || visible.length === 0 ? (
              <TableStatus
                span={7}
                loading={isLoading}
                error={isError}
                emptyText="No sales logged yet — sell from the Drawer."
              />
            ) : (
              visible.map((r) => {
                const vm = vsMedian(r);
                return (
                  <tr key={r.id} {...rowAction(() => onOpen(r.slug))}>
                    <td className="when">{relativeDay(r.sold_at)}</td>
                    <td>
                      <ItemName
                        name={r.display_name}
                        plat={r.plat_per_unit}
                        thumb={r.thumbnail_url}
                        sub={CATEGORY_LABELS[r.category] ?? r.category}
                        tags={
                          r.notes ? (
                            <span className="note-mark" title={r.notes}>
                              ✎
                            </span>
                          ) : null
                        }
                      />
                    </td>
                    <td
                      className={clsx("r", vm == null ? "muted" : vm >= 0 ? "pos" : "neg")}
                      title={
                        r.market_median_at_sale_time != null
                          ? `market median was ${r.market_median_at_sale_time}p at sale time`
                          : undefined
                      }
                    >
                      {vm == null ? "—" : pct(vm)}
                      {vm != null && vm >= 10 ? <span className="deal">good</span> : null}
                    </td>
                    <td className="r">{r.qty}</td>
                    <td className="r">{fmt(r.plat_per_unit)}p</td>
                    <td className="r">{fmt(saleTotal(r))}p</td>
                    <td
                      className="r"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {isToday(r.sold_at) ? (
                        <button
                          type="button"
                          className="rm"
                          title="Undo"
                          onClick={() => undo.mutate(r.id)}
                        >
                          ↺
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
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
