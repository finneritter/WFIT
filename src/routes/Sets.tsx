import { useMemo, useState } from "react";
import { StatBox } from "../components/ui";
import { useAddToBuyList, useSets } from "../hooks/queries";
import { clsx, fmt } from "../lib/format";
import type { SetRow } from "../lib/types";

type Filter = "all" | "complete" | "almost" | "progress";

function Row({ row, onOpen }: { row: SetRow; onOpen: (slug: string) => void }) {
  const buy = useAddToBuyList();
  const ratio = row.total_parts ? row.owned_parts / row.total_parts : 0;
  const missing = row.total_parts - row.owned_parts;
  return (
    <div className="setrow">
      <div className="set-main">
        <div className="snm">{row.set_name}</div>
        <div className="ssub">
          {row.category} · {row.owned_parts}/{row.total_parts} parts
        </div>
        <div className={clsx("set-bar", row.complete && "done")}>
          <i style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      </div>
      <div className="pchips">
        {row.parts.map((p) => (
          <div
            key={p.slug}
            className={clsx("pchip", p.owned ? "have" : "miss")}
            onClick={() => (p.owned ? onOpen(p.slug) : buy.mutate({ slug: p.slug }))}
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

  const stats = useMemo(() => {
    const complete = sets.filter((s) => s.complete).length;
    const oneAway = sets.filter((s) => s.total_parts - s.owned_parts === 1).length;
    const completableValue = sets
      .filter((s) => s.complete)
      .reduce((a, s) => a + (s.set_value ?? 0), 0);
    const avg =
      sets.length === 0
        ? 0
        : (sets.reduce((a, s) => a + (s.total_parts ? s.owned_parts / s.total_parts : 0), 0) /
            sets.length) *
          100;
    return { complete, oneAway, completableValue, avg };
  }, [sets]);

  const rows = useMemo(() => {
    return sets.filter((s) => {
      const missing = s.total_parts - s.owned_parts;
      if (filter === "complete") return s.complete;
      if (filter === "almost") return missing === 1;
      if (filter === "progress") return !s.complete && s.owned_parts > 0;
      return true;
    });
  }, [sets, filter]);

  return (
    <>
      <div className="statband" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
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

      <div className="tpanel">
        {isError ? (
          <div className="empty">Couldn't load sets. Try again in a moment.</div>
        ) : isLoading ? (
          <div className="empty">Loading sets…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No sets match this filter.</div>
        ) : (
          rows.map((s) => <Row key={s.set_slug} row={s} onOpen={onOpen} />)
        )}
      </div>
    </>
  );
}
