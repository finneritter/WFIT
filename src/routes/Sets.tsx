import { useEffect, useMemo } from "react";
import type { ScreenId } from "../components/Sidebar";
import { BlockStatus, Chip, StatBox } from "../components/ui";
import { useSets } from "../hooks/queries";
import { useColumnSort, usePaged } from "../hooks/useTable";
import { clsx, fmt } from "../lib/format";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { setsSchema } from "../lib/searchSchemas";
import type { SetRow } from "../lib/types";

type NavFn = (s: ScreenId, opts?: { marketSlug?: string; focusSetSlug?: string }) => void;

const ratio = (s: SetRow) => (s.total_parts ? s.owned_parts / s.total_parts : 0);

type SetCol = "name" | "completion" | "value" | "missing";
const SET_CMP: Record<SetCol, (a: SetRow, b: SetRow) => number> = {
  name: (a, b) => a.set_name.localeCompare(b.set_name),
  completion: (a, b) => ratio(a) - ratio(b),
  value: (a, b) => (a.set_value ?? 0) - (b.set_value ?? 0),
  missing: (a, b) => (a.missing_value ?? 0) - (b.missing_value ?? 0),
};

function Row({
  row,
  onOpen,
  onNavigate,
}: {
  row: SetRow;
  onOpen: (slug: string) => void;
  onNavigate: NavFn;
}) {
  // Owned parts open the in-app drawer; a missing part is a "buy this" cue, so it
  // jumps straight to that item's live warframe.market listing in the Market screen.
  const goMarket = (slug: string) => onNavigate("market", { marketSlug: slug });
  return (
    <div className="setrow" data-set-slug={row.set_slug}>
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
            onClick={() => (p.owned ? onOpen(p.slug) : goMarket(p.slug))}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                e.preventDefault();
                if (p.owned) onOpen(p.slug);
                else goMarket(p.slug);
              }
            }}
            title={p.owned ? p.part_name : `Buy ${p.part_name} on warframe.market`}
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
            <div className="sv num">
              {row.missing_value == null ? "—" : `+${fmt(row.missing_value)}p`}
            </div>
            <div className="sx">to complete</div>
          </>
        )}
      </div>
    </div>
  );
}

export function Sets({
  onOpen,
  onNavigate,
  focusSetSlug,
}: {
  onOpen: (slug: string) => void;
  onNavigate: NavFn;
  focusSetSlug?: string | null;
}) {
  const { data: sets = [], isLoading, isError } = useSets();
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
  const rows = useMemo(() => apply(sets.filter(test)), [sets, test, apply]);
  const { visible, hasMore, shown, total, more } = usePaged(
    rows,
    36,
    `${search}|${sort ? sort.key + sort.dir : ""}`,
  );

  // Deep-link from the Relics "To crack" backlink: scroll to + flash the target row.
  useEffect(() => {
    if (!focusSetSlug) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector(`[data-set-slug="${focusSetSlug}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("flash");
      window.setTimeout(() => el.classList.remove("flash"), 1600);
    }, 80);
    return () => window.clearTimeout(t);
  }, [focusSetSlug]);

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

      <div className="mkt-filters">
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
          <BlockStatus error />
        ) : isLoading ? (
          <BlockStatus />
        ) : visible.length === 0 ? (
          <BlockStatus text="No sets match your search." />
        ) : (
          <>
            {visible.map((s) => (
              <Row key={s.set_slug} row={s} onOpen={onOpen} onNavigate={onNavigate} />
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
