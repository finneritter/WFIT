import { useMemo } from "react";
import { Glyph, StatBox } from "../components/ui";
import { useDucats } from "../hooks/queries";
import { clsx, fmt } from "../lib/format";

export function Ducats({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: rows = [], isLoading } = useDucats();

  const stats = useMemo(() => {
    const invDucats = rows.reduce((s, r) => s + r.ducats * r.qty, 0);
    const trash = rows.filter((r) => (r.median_plat ?? 0) <= 8);
    const trashDucats = trash.reduce((s, r) => s + r.ducats * r.qty, 0);
    const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.ducats, 0) / rows.length) : 0;
    return { invDucats, trashDucats, trashCount: trash.length, avg };
  }, [rows]);

  return (
    <>
      <div className="statband" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <StatBox k="Inventory ducats" v={fmt(stats.invDucats)} unit="d" />
        <StatBox k="Trash-tier ducats" v={fmt(stats.trashDucats)} unit="d" />
        <StatBox k="Trash candidates" v={fmt(stats.trashCount)} />
        <StatBox k="Avg ducats/part" v={fmt(stats.avg)} unit="d" />
      </div>

      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Best ducat value</h3>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Part</th>
              <th className="r">Plat</th>
              <th className="r">Ducats</th>
              <th className="r">d/p</th>
              <th>Verdict</th>
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
                  Own some prime parts to see ducat efficiency.
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
                        <span className="sub">
                          {r.part_type} · ×{r.qty}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="r">{fmt(r.median_plat)}p</td>
                  <td className="r">{fmt(r.ducats)}d</td>
                  <td className="r">{r.ducats_per_plat == null ? "—" : r.ducats_per_plat.toFixed(1)}</td>
                  <td>
                    <span className={clsx("badge", r.verdict === "ducat" && "at")}>
                      {r.verdict === "ducat" ? "ducat it" : "sell for plat"}
                    </span>
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
