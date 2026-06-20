import { useMemo } from "react";
import { ItemTags } from "../components/ItemTags";
import { Chip, ItemName, SortTh, StatBox, TableStatus, rowAction } from "../components/ui";
import { useAddToBuyList, useListedSlugs, useRemoveWatch, useWatchlist } from "../hooks/queries";
import { useColumnSort, usePaged } from "../hooks/useTable";
import { atTarget, clsx, fmt, pct, relativeDay } from "../lib/format";
import { usePersisted } from "../lib/persist";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { watchlistSchema } from "../lib/searchSchemas";
import type { WatchRow } from "../lib/types";

// Gap from target as a fraction (how far the price still has to fall). null when
// unknown; used both for the status badge and the gap-aware default ordering.
const gapFrac = (r: WatchRow): number | null =>
  r.target_plat != null && r.median_plat != null && r.target_plat > 0
    ? (r.median_plat - r.target_plat) / r.target_plat
    : null;

type WatchCol = "name" | "price" | "delta" | "target" | "added";
const WATCH_CMP: Record<WatchCol, (a: WatchRow, b: WatchRow) => number> = {
  name: (a, b) => a.display_name.localeCompare(b.display_name),
  price: (a, b) => (a.median_plat ?? 0) - (b.median_plat ?? 0),
  delta: (a, b) => (a.delta_7d ?? 0) - (b.delta_7d ?? 0),
  target: (a, b) => (a.target_plat ?? 0) - (b.target_plat ?? 0),
  added: (a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime(),
};

export function Watchlist({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: rows = [], isLoading, isError } = useWatchlist();
  const listed = useListedSlugs();
  const buy = useAddToBuyList();
  const remove = useRemoveWatch();
  const [atOnly, setAtOnly] = usePersisted<"1" | "0">("wfit-watch-at", "0");
  const [vaulted, setVaulted] = usePersisted<"1" | "0">("wfit-watch-vault", "0");
  const [falling, setFalling] = usePersisted<"1" | "0">("wfit-watch-fall", "0");
  const { sort, cycle, apply } = useColumnSort<WatchRow, WatchCol>("wfit-watch-sort", WATCH_CMP);
  const search = usePageSearch();
  const { test } = useMemo(() => compileQuery(search, watchlistSchema), [search]);

  const stats = useMemo(() => {
    const watching = rows.length;
    const at = rows.filter(atTarget).length;
    const spend = rows.filter(atTarget).reduce((s, r) => s + (r.median_plat ?? 0), 0);
    const gaps = rows.map(gapFrac).filter((g): g is number => g != null && g > 0);
    const avgGap = gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length) * 100 : 0;
    return { watching, at, spend, avgGap };
  }, [rows]);

  const view = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (atOnly === "1" && !atTarget(r)) return false;
      if (vaulted === "1" && !r.is_vaulted) return false;
      if (falling === "1" && (r.delta_7d ?? 0) >= 0) return false;
      return test(r);
    });
    // No active column sort → at-target first, then alphabetical (the original default).
    return sort
      ? apply(filtered)
      : [...filtered].sort(
          (a, b) =>
            Number(atTarget(b)) - Number(atTarget(a)) ||
            a.display_name.localeCompare(b.display_name),
        );
  }, [rows, atOnly, vaulted, falling, test, sort, apply]);
  const { visible, hasMore, shown, total, more } = usePaged(
    view,
    60,
    `${atOnly}|${vaulted}|${falling}|${search}|${sort ? sort.key + sort.dir : ""}`,
  );

  return (
    <>
      <div className="statband">
        <StatBox k="Watching" v={fmt(stats.watching)} />
        <StatBox k="At buy target" v={fmt(stats.at)} dcls="pos" />
        <StatBox k="Buy-now spend" v={fmt(stats.spend)} unit="p" />
        <StatBox k="Avg gap to target" v={`${stats.avgGap.toFixed(0)}%`} />
      </div>

      <div className="mkt-filters">
        <Chip active={atOnly === "1"} onClick={() => setAtOnly(atOnly === "1" ? "0" : "1")}>
          At target
        </Chip>
        <Chip active={falling === "1"} onClick={() => setFalling(falling === "1" ? "0" : "1")}>
          Trending down
        </Chip>
        <Chip active={vaulted === "1"} onClick={() => setVaulted(vaulted === "1" ? "0" : "1")}>
          Vaulted
        </Chip>
      </div>

      <div className="tpanel">
        <table className="dtable">
          <thead>
            <tr>
              <SortTh<WatchCol> label="Item" col="name" sort={sort} onSort={cycle} />
              <SortTh<WatchCol> label="Price" col="price" sort={sort} onSort={cycle} right />
              <SortTh<WatchCol> label="7d" col="delta" sort={sort} onSort={cycle} right />
              <SortTh<WatchCol> label="Target" col="target" sort={sort} onSort={cycle} right />
              <th>Status</th>
              <SortTh<WatchCol> label="Added" col="added" sort={sort} onSort={cycle} right />
              <th className="r">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || visible.length === 0 ? (
              <TableStatus
                span={7}
                loading={isLoading}
                error={isError}
                emptyText="Nothing watched yet — add items from the Drawer."
              />
            ) : (
              visible.map((r) => {
                const at = atTarget(r);
                const gap = gapFrac(r);
                return (
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
                    <td className={clsx("r", (r.delta_7d ?? 0) >= 0 ? "pos" : "neg")}>
                      {r.delta_7d == null ? "—" : pct(r.delta_7d)}
                    </td>
                    <td className="r">{r.target_plat == null ? "—" : `${fmt(r.target_plat)}p`}</td>
                    <td>
                      {at ? (
                        <span className="badge at">at target</span>
                      ) : (
                        <span className="badge above">
                          {gap == null ? "—" : `+${Math.round(gap * 100)}% to go`}
                        </span>
                      )}
                    </td>
                    <td className="r muted">{relativeDay(r.added_at)}</td>
                    <td
                      className="r"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
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
        {hasMore ? (
          <button type="button" className="btn load-more" onClick={more}>
            Showing {shown} of {fmt(total)} — load more
          </button>
        ) : null}
      </div>
    </>
  );
}
