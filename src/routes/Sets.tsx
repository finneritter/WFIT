// The Sets screen: every ownable prime set in one full-bleed sortable table
// (the Relics browser treatment) — completion, plat-to-finish, and the
// set-vs-parts spread. Clicking a row opens the SetDrawer (part chips +
// per-part prices + economics).
import { useEffect, useMemo } from "react";
import { Dropdown } from "../components/Dropdown";
import { ItemTags } from "../components/ItemTags";
import { setPartsSum } from "../components/SetDrawer";
import { Chip, ItemName, SortTh, StatBox, TableStatus, rowAction } from "../components/ui";
import { useListedSlugs, useSets } from "../hooks/queries";
import { useColumnSort } from "../hooks/useTable";
import { clsx, fmt } from "../lib/format";
import { usePersisted } from "../lib/persist";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { setsSchema } from "../lib/searchSchemas";
import type { SetRow } from "../lib/types";

const ratio = (s: SetRow) => (s.total_parts ? s.owned_parts / s.total_parts : 0);
const delta = (s: SetRow) => {
  const sum = setPartsSum(s);
  return s.set_value != null && sum != null ? s.set_value - sum : null;
};

type Col = "name" | "parts" | "missing" | "value" | "sum" | "delta";
const CMP: Record<Col, (a: SetRow, b: SetRow) => number> = {
  name: (a, b) => a.set_name.localeCompare(b.set_name),
  parts: (a, b) => ratio(a) - ratio(b),
  missing: (a, b) => (a.missing_value ?? 0) - (b.missing_value ?? 0),
  value: (a, b) => (a.set_value ?? 0) - (b.set_value ?? 0),
  sum: (a, b) => (setPartsSum(a) ?? 0) - (setPartsSum(b) ?? 0),
  delta: (a, b) => (delta(a) ?? -1e9) - (delta(b) ?? -1e9),
};

// Default order (no column chosen): closest to done first, richer spread first.
function completionOrder(a: SetRow, b: SetRow): number {
  return (
    ratio(b) - ratio(a) ||
    (delta(b) ?? -1e9) - (delta(a) ?? -1e9) ||
    a.set_name.localeCompare(b.set_name)
  );
}

type StateFilter = "all" | "complete" | "oneaway" | "progress";
const STATE_CHIPS: [StateFilter, string][] = [
  ["complete", "Complete"],
  ["oneaway", "One away"],
  ["progress", "In progress"],
];

function matchesState(s: SetRow, f: StateFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "complete":
      return s.complete;
    case "oneaway":
      return !s.complete && s.total_parts - s.owned_parts === 1;
    case "progress":
      return !s.complete && s.owned_parts > 0;
  }
}

export function Sets({
  onOpenSet,
  focusSetSlug,
}: {
  onOpenSet: (slug: string) => void;
  focusSetSlug?: string | null;
}) {
  const { data: sets = [], isLoading, isError } = useSets();
  const listed = useListedSlugs();
  const search = usePageSearch();
  const [stateFilter, setStateFilter] = usePersisted<StateFilter>("wfit-sets-state", "all");
  const [catFilter, setCatFilter] = usePersisted<string>("wfit-sets-cat", "all");
  const sort = useColumnSort<SetRow, Col>("wfit-sets-sort-v2", CMP, null);

  const catOptions = useMemo(() => {
    const cats = [...new Set(sets.map((s) => s.category))].sort();
    return [["all", "All categories"], ...cats.map((c) => [c, c] as const)] as const;
  }, [sets]);

  const stats = useMemo(() => {
    const complete = sets.filter((s) => s.complete).length;
    const oneAway = sets.filter((s) => !s.complete && s.total_parts - s.owned_parts === 1).length;
    const completableValue = sets
      .filter((s) => s.complete)
      .reduce((a, s) => a + (s.set_value ?? 0), 0);
    const avg =
      sets.length === 0 ? 0 : (sets.reduce((a, s) => a + ratio(s), 0) / sets.length) * 100;
    return { complete, oneAway, completableValue, avg };
  }, [sets]);

  const { test } = useMemo(() => compileQuery(search, setsSchema), [search]);
  const view = useMemo(() => {
    const filtered = sets.filter(
      (s) =>
        test(s) &&
        matchesState(s, stateFilter) &&
        (catFilter === "all" || s.category === catFilter),
    );
    return sort.sort ? sort.apply(filtered) : [...filtered].sort(completionOrder);
  }, [sets, test, stateFilter, catFilter, sort.sort, sort.apply]);

  const totals = useMemo(() => {
    let complete = 0;
    let toFinish = 0;
    let setValue = 0;
    for (const s of view) {
      if (s.complete) complete += 1;
      else toFinish += s.missing_value ?? 0;
      setValue += s.set_value ?? 0;
    }
    return { complete, toFinish, setValue };
  }, [view]);

  // Deep-link from the Relics "→ set" backlink: scroll to + flash the target row.
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

  return (
    <div className="rtable-wrap">
      <div className="statband">
        <StatBox k="Complete sets" v={fmt(stats.complete)} />
        <StatBox k="One part away" v={fmt(stats.oneAway)} />
        <StatBox k="Completable value" v={fmt(stats.completableValue)} unit="p" />
        <StatBox k="Avg completion" v={`${stats.avg.toFixed(0)}%`} />
      </div>

      <div className="mkt-filters rtable-filters">
        {STATE_CHIPS.map(([f, label]) => (
          <Chip
            key={f}
            active={stateFilter === f}
            onClick={() => setStateFilter(stateFilter === f ? "all" : f)}
          >
            {label}
          </Chip>
        ))}
        <Dropdown value={catFilter} options={catOptions} onChange={setCatFilter} title="Category" />
      </div>

      <div className="rtable-scroll">
        <table className="dtable rtable settable">
          <thead>
            <tr>
              <SortTh<Col> label="Set" col="name" sort={sort.sort} onSort={sort.cycle} />
              <SortTh<Col> label="Parts" col="parts" sort={sort.sort} onSort={sort.cycle} right />
              <SortTh<Col>
                label="To finish"
                col="missing"
                sort={sort.sort}
                onSort={sort.cycle}
                right
              />
              <SortTh<Col>
                label="Set price"
                col="value"
                sort={sort.sort}
                onSort={sort.cycle}
                right
              />
              <SortTh<Col> label="Parts sum" col="sum" sort={sort.sort} onSort={sort.cycle} right />
              <SortTh<Col>
                label="Δ set−parts"
                col="delta"
                sort={sort.sort}
                onSort={sort.cycle}
                right
              />
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || view.length === 0 ? (
              <TableStatus
                span={6}
                loading={isLoading}
                error={isError}
                emptyText="No sets match the current filters."
              />
            ) : (
              view.map((s) => <Row key={s.set_slug} s={s} listed={listed} onOpenSet={onOpenSet} />)
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>
                <span className="num">{fmt(totals.complete)}</span>/
                <span className="num">{fmt(view.length)}</span> complete · to finish all{" "}
                <span className="num">{fmt(totals.toFinish)}p</span> · set value{" "}
                <span className="num">{fmt(totals.setValue)}p</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Row({
  s,
  listed,
  onOpenSet,
}: {
  s: SetRow;
  listed: Set<string>;
  onOpenSet: (slug: string) => void;
}) {
  const oneAway = !s.complete && s.total_parts - s.owned_parts === 1;
  const sum = setPartsSum(s);
  const d = delta(s);
  return (
    <tr
      className={clsx("rt-row", s.owned_parts === 0 && "rt-unowned")}
      data-set-slug={s.set_slug}
      {...rowAction(() => onOpenSet(s.set_slug))}
    >
      <td>
        <ItemName
          name={s.set_name}
          plat={s.set_value}
          sub={s.category}
          tags={
            <>
              {s.complete ? (
                <span className="itag itag-complete" title="all parts owned">
                  COMPLETE
                </span>
              ) : oneAway ? (
                <span className="itag itag-oneaway" title="one part missing">
                  ONE AWAY
                </span>
              ) : null}
              <ItemTags listed={listed.has(s.set_slug)} />
            </>
          }
        />
      </td>
      <td className="r num">
        <span className={clsx(s.complete && "pos", s.owned_parts === 0 && "muted")}>
          {s.owned_parts}/{s.total_parts}
        </span>
      </td>
      <td className="r num">
        {s.complete ? (
          <span className="muted">—</span>
        ) : s.missing_value != null ? (
          `${fmt(s.missing_value)}p`
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className={clsx("r num", s.set_value == null && "muted")}>
        {s.set_value != null ? `${fmt(s.set_value)}p` : "—"}
      </td>
      <td className={clsx("r num", sum == null && "muted")}>
        {sum != null ? `${fmt(sum)}p` : "—"}
      </td>
      <td className={clsx("r num", d != null && (d >= 0 ? "pos" : "neg"))}>
        {d != null ? `${d >= 0 ? "+" : ""}${fmt(d)}p` : <span className="muted">—</span>}
      </td>
    </tr>
  );
}
