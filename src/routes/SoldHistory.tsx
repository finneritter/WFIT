import { useMemo } from "react";
import { Glyph, StatBox, TableStatus } from "../components/ui";
import { useSales, useUndoSale } from "../hooks/queries";
import { fmt, relativeDay } from "../lib/format";

export function SoldHistory({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: rows = [], isLoading, isError } = useSales();
  const undo = useUndoSale();

  const stats = useMemo(() => {
    const now = Date.now();
    const within = (days: number, r: { sold_at: string }) =>
      now - new Date(r.sold_at).getTime() <= days * 86_400_000;
    const total = (rs: typeof rows) => rs.reduce((s, r) => s + (r.plat_per_unit ?? 0) * r.qty, 0);
    const e7 = total(rows.filter((r) => within(7, r)));
    const e30 = total(rows.filter((r) => within(30, r)));
    const units = rows.reduce((s, r) => s + r.qty, 0);
    const totalPlat = total(rows);
    const avg = units ? Math.round(totalPlat / units) : 0;
    const best = rows.reduce((m, r) => Math.max(m, r.plat_per_unit ?? 0), 0);
    return { e7, e30, units, avg, best };
  }, [rows]);

  const isToday = (iso: string) => relativeDay(iso) === "today";

  return (
    <>
      <div className="statband" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <StatBox k="Earned · 7d" v={fmt(stats.e7)} unit="p" dcls="pos" />
        <StatBox k="Earned · 30d" v={fmt(stats.e30)} unit="p" />
        <StatBox k="Units sold" v={fmt(stats.units)} />
        <StatBox k="Avg sale" v={fmt(stats.avg)} unit="p" />
        <StatBox k="Best sale" v={fmt(stats.best)} unit="p" />
      </div>

      <div className="tpanel">
        <table className="dtable">
          <thead>
            <tr>
              <th>When</th>
              <th>Item</th>
              <th className="r">Qty</th>
              <th className="r">Unit</th>
              <th className="r">Total</th>
              <th className="r" />
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || rows.length === 0 ? (
              <TableStatus
                span={6}
                loading={isLoading}
                error={isError}
                emptyText="No sales logged yet — sell from the Drawer."
              />
            ) : (
              rows.map((r) => (
                <tr key={r.id} onClick={() => onOpen(r.slug)}>
                  <td className="when">{relativeDay(r.sold_at)}</td>
                  <td>
                    <div className="dnm">
                      <Glyph name={r.display_name} plat={r.plat_per_unit} thumb={r.thumbnail_url} />
                      <div className="di">
                        <span className="nm">{r.display_name}</span>
                        <span className="sub">{r.category}</span>
                      </div>
                    </div>
                  </td>
                  <td className="r">{r.qty}</td>
                  <td className="r">{fmt(r.plat_per_unit)}p</td>
                  <td className="r">{fmt((r.plat_per_unit ?? 0) * r.qty)}p</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
