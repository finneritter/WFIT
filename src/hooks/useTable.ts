// Shared table machinery: click-to-sort column state and load-more paging.
// Pairs with the presentational <SortTh> in components/ui.tsx. Each screen
// declares its own column-key union + ascending comparators; the cycle and
// persistence are handled here so no screen reimplements them.
import { useEffect, useState } from "react";
import { usePersistedJSON } from "../lib/persist";

export interface ColSort<K extends string> {
  key: K;
  dir: "asc" | "desc";
}

/** Click-to-sort state (persisted): each header cycles asc → desc → off.
 *  `comparators` are ascending; `apply` returns a sorted copy (the input order
 *  when no column is active). Wrap `apply(rows)` in the caller's useMemo. */
export function useColumnSort<T, K extends string>(
  persistKey: string,
  comparators: Record<K, (a: T, b: T) => number>,
  initial: ColSort<K> | null = null,
) {
  const [sort, setSort] = usePersistedJSON<ColSort<K> | null>(persistKey, initial);
  const cycle = (key: K) =>
    setSort((cur) =>
      !cur || cur.key !== key
        ? { key, dir: "asc" }
        : cur.dir === "asc"
          ? { key, dir: "desc" }
          : null,
    );
  const apply = (rows: T[]): T[] => {
    if (!sort) return rows;
    const cmp = comparators[sort.key];
    return [...rows].sort((a, b) => (sort.dir === "asc" ? cmp(a, b) : -cmp(a, b)));
  };
  return { sort, cycle, apply };
}

/** Load-more paging over a (memoized) list. Resets to the first page when the
 *  caller's filter/sort `resetKey` changes — NOT on every `items` identity change.
 *  Background refetches (the price heartbeat) hand back a fresh array every ~45-60s;
 *  keying the reset on `items` would collapse an expanded list out from under the
 *  user mid-scroll. `slice` already tolerates `limit > items.length`, so a shrinking
 *  list needs no reset. Omitting `resetKey` is safe (never auto-collapses). */
export function usePaged<T>(items: T[], page = 50, resetKey?: unknown) {
  const [limit, setLimit] = useState(page);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset paging only when the filter/sort key changes
  useEffect(() => setLimit(page), [resetKey, page]);
  return {
    visible: items.slice(0, limit),
    hasMore: items.length > limit,
    shown: Math.min(limit, items.length),
    total: items.length,
    more: () => setLimit((l) => l + page),
  };
}
