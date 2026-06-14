import { useMemo, useState } from "react";
import { Chip, StatBox } from "../components/ui";
import { useAddToBuyList, useSets } from "../hooks/queries";
import { useColumnSort, usePaged } from "../hooks/useTable";
import { clsx, fmt } from "../lib/format";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { setsSchema } from "../lib/searchSchemas";
import type { SetRow } from "../lib/types";

type Filter = "all" | "complete" | "almost" | "progress";

const ratio = (s: SetRow) => (s.total_parts ? s.owned_parts / s.total_parts : 0);

type SetCol = "name" | "completion" | "value" | "missing";
const SET_CMP: Record<SetCol, (a: SetRow, b: SetRow) => number> = {
  name: (a, b) => a.set_name.localeCompare(b.set_name),
  completion: (a, b) => ratio(a) - ratio(b),
  value: (a, b) => (a.set_value ?? 0) - (b.set_value ?? 0),
  missing: (a, b) => (a.missing_value ?? 0) - (b.missing_value ?? 0),
};

function Row({ row, onOpen }: { row: SetRow; onOpen: (slug: string) => void }) {
  const buy = useAddToBuyList();
  const missing = row.total_parts - row.owned_parts;
  return (
    <div className="setrow">
      <div className="set-main">
        <div className="snm">{row.set_name}</div>
        <div className="ssub">
          {row.category} · {row.owned_parts}/{row.total_parts} parts
        </div>
        <div className={clsx("set-bar", row.complete && "done")}>
          <i style={{ width: `${Math.round(ratio(row) * 100)}%` }} />
        </div>
      </div>
      <div className="pchips">
        {row.parts.map((p) => (
          <div
            key={p.slug}
            className={clsx("pchip", p.owned ? "have" : "miss")}
            // biome-ignore lint/a11y/useSemanticElements: styled as a div chip; no native-button reset exists in the theme
            role="button"
            tabIndex={0}
            onClick={() => (p.owned ? onOpen(p.slug) : buy.mutate({ slug: p.slug }))}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                e.preventDefault();
                if (p.owned) onOpen(p.slug);
                else buy.mutate({ slug: p.slug });
              }
            }}
            title={p.owned ? p.part_name : `Add ${p.part_name} to buy list`}
          >
            <span className="pa">{p.part_name.slice(0, 3)}</span>
            {p.owned ? (
              <span className="ck">✓</span>
            ) : (
              <span className="pp">{p.median_plat == null ? "—" : `${fmt(p.median_plat)}p`}</span>
            )}
          </div>
        ))}
      </div>
      <div className="set-act">
        {row.complete ? (
          <>
            <div className="sv num">{fmt(row.set_value)}p</div>
            <div className="sx">full-set value</div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                for (const p of row.parts.filter((p) => !p.owned)) buy.mutate({ slug: p.slug });
              }}
            >
              Buy {missing} missing
            </button>
            <div className="sx">
              {row.missing_value == null ? "" : `+${fmt(row.missing_value)}p to complete`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Sets({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: sets = [], isLoading, isError } = useSets();
  const [filter, setFilter] = useState<Filter>("all");
  const search = usePageSearch();
  const { sort, cycle, apply } = useColumnSort<SetRow, SetCol>("wfit-sets-sort", SET_CMP, {
    key: "completion",
    dir: "desc",
  });

  const stats = useMemo(() => {
    const complete = sets.filter((s) => s.complete).length;
    const oneAway = sets.filter((s) => s.total_parts - s.owned_parts === 1).length;
    const completableValue = sets
      .filter((s) => s.complete)
      .reduce((a, s) => a + (s.set_value ?? 0), 0);
    const avg =
      sets.length === 0 ? 0 : (sets.reduce((a, s) => a + ratio(s), 0) / sets.length) * 100;
    return { complete, oneAway, completableValue, avg };
  }, [sets]);

  const { test } = useMemo(() => compileQuery(search, setsSchema), [search]);
  const rows = useMemo(() => {
    const filtered = sets.filter((s) => {
      const missing = s.total_parts - s.owned_parts;
      if (filter === "complete" && !s.complete) return false;
      if (filter === "almost" && missing !== 1) return false;
      if (filter === "progress" && (s.complete || s.owned_parts === 0)) return false;
      return test(s);
    });
    return apply(filtered);
  }, [sets, filter, test, apply]);
  const { visible, hasMore, shown, total, more } = usePaged(
    rows,
    36,
    `${filter}|${search}|${sort ? sort.key + sort.dir : ""}`,
  );

  const sortChip = (col: SetCol, label: string) => (
    <Chip active={sort?.key === col} onClick={() => cycle(col)}>
      {label}
      {sort?.key === col ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </Chip>
  );

  return (
    <>
      <div className="statband">
        <StatBox k="Complete sets" v={fmt(stats.complete)} />
        <StatBox k="One part away" v={fmt(stats.oneAway)} />
        <StatBox k="Completable value" v={fmt(stats.completableValue)} unit="p" />
        <StatBox k="Avg completion" v={`${stats.avg.toFixed(0)}%`} />
      </div>

      <div className="filters">
        {(
          [
            ["all", "All"],
            ["complete", "Complete"],
            ["almost", "Almost done"],
            ["progress", "In progress"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className="chip"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mkt-filters" style={{ marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 11 }}>
          Sort
        </span>
        {sortChip("completion", "Completion")}
        {sortChip("value", "Set value")}
        {sortChip("missing", "To complete")}
        {sortChip("name", "Name")}
      </div>

      <div className="tpanel">
        {isError ? (
          <div className="empty">Couldn't load sets. Try again in a moment.</div>
        ) : isLoading ? (
          <div className="empty">Loading sets…</div>
        ) : visible.length === 0 ? (
          <div className="empty">No sets match this filter.</div>
        ) : (
          <>
            {visible.map((s) => (
              <Row key={s.set_slug} row={s} onOpen={onOpen} />
            ))}
            {hasMore ? (
              <button type="button" className="btn load-more" onClick={more}>
                Showing {shown} of {fmt(total)} — load more
              </button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
