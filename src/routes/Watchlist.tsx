import { useMemo } from "react";
import { Glyph, StatBox } from "../components/ui";
import { useAddToBuyList, useRemoveWatch, useWatchlist } from "../hooks/queries";
import { clsx, fmt, pct } from "../lib/format";

export function Watchlist({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: rows = [], isLoading } = useWatchlist();
  const buy = useAddToBuyList();
  const remove = useRemoveWatch();

  const atTarget = (r: { median_plat: number | null; target_plat: number | null }) =>
    r.target_plat != null && r.median_plat != null && r.median_plat <= r.target_plat;

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => Number(atTarget(b)) - Number(atTarget(a)) ||
        a.display_name.localeCompare(b.display_name)),
    [rows],
  );

  const stats = useMemo(() => {
    const watching = rows.length;
    const at = rows.filter(atTarget).length;
    const spend = rows.filter(atTarget).reduce((s, r) => s + (r.median_plat ?? 0), 0);
    const gaps = rows
      .filter((r) => r.target_plat != null && r.median_plat != null && r.median_plat > r.target_plat)
      .map((r) => ((r.median_plat! - r.target_plat!) / r.target_plat!) * 100);
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    return { watching, at, spend, avgGap };
  }, [rows]);

  return (
    <>
      <div className="statband" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <StatBox k="Watching" v={fmt(stats.watching)} />
        <StatBox k="At buy target" v={fmt(stats.at)} dcls="pos" />
        <StatBox k="Buy-now spend" v={fmt(stats.spend)} unit="p" />
        <StatBox k="Avg gap to target" v={`${stats.avgGap.toFixed(0)}%`} />
      </div>

      <div className="tpanel">
        <table className="dtable">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Price</th>
              <th className="r">7d</th>
              <th className="r">Target</th>
              <th>Status</th>
              <th className="r">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="muted">
                  Loading…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing watched yet — add items from the Drawer.
                </td>
              </tr>
            ) : (
              sorted.map((r) => {
                const at = atTarget(r);
                const gap =
                  r.target_plat != null && r.median_plat != null && r.target_plat > 0
                    ? Math.round(((r.median_plat - r.target_plat) / r.target_plat) * 100)
                    : null;
                return (
                  <tr key={r.slug} onClick={() => onOpen(r.slug)}>
                    <td>
                      <div className="dnm">
                        <Glyph name={r.display_name} plat={r.median_plat} thumb={r.thumbnail_url} />
                        <div className="di">
                          <span className="nm">{r.display_name}</span>
                          <span className="sub">{r.part_type}</span>
                        </div>
                      </div>
                    </td>
                    <td className="r">{fmt(r.median_plat)}p</td>
                    <td className={clsx("r", (r.delta_7d ?? 0) >= 0 ? "pos" : "neg")}>
                      {r.delta_7d == null ? "—" : pct(r.delta_7d)}
                    </td>
                    <td className="r">{r.target_plat == null ? "—" : `${fmt(r.target_plat)}p`}</td>
                    <td>
                      {at ? (
                        <span className="badge at">at target</span>
                      ) : (
                        <span className="badge above">{gap == null ? "—" : `+${gap}% to go`}</span>
                      )}
                    </td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => buy.mutate({ slug: r.slug })}
                      >
                        + buy
                      </button>{" "}
                      <button type="button" className="rm" onClick={() => remove.mutate(r.slug)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
