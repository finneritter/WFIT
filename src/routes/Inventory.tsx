import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Dropdown, type DropdownOption } from "../components/Dropdown";
import { Icon } from "../components/Icon";
import { Spark } from "../components/charts";
import { Glyph, SortTh, StatBox, rowAction } from "../components/ui";
import { useInventory, useListings, usePricingProgress, useSummary } from "../hooks/queries";
import { CATEGORY_LABELS, clsx, fmt, fmtK, glyph, pct, tier, trendOf } from "../lib/format";
import { usePersisted } from "../lib/persist";
import type { InventoryRow } from "../lib/types";

type SortKey = "value-desc" | "value-asc" | "trend" | "name";
type ViewKey = "grid" | "chips" | "list";
const CATS = ["warframe", "weapon", "set", "mod", "arcane"] as const;

const SORT_OPTS: readonly DropdownOption[] = [
  ["value-desc", "Value · high"],
  ["value-asc", "Value · low"],
  ["trend", "Trend"],
  ["name", "Name"],
];
const VIEWS: readonly DropdownOption[] = [
  ["grid", "Grid", "grid"],
  ["chips", "Chips", "chips"],
  ["list", "List", "rows"],
];

// Full market value of a row (the optimistic "ceiling"): rank-aware value_plat for
// mods/arcanes, else median × qty.
const rowValue = (r: InventoryRow) => r.value_plat ?? (r.median_plat ?? 0) * r.qty;
// Liquidation-adjusted value — the honest worth. Drives totals + sort so illiquid
// hoards sink instead of inflating the inventory.
const realValue = (r: InventoryRow) => r.realizable_plat ?? rowValue(r);

// Click-to-sort state for the List view's column headers. Each header cycles
// asc → desc → off; when set it overrides the toolbar sort dropdown.
type ColKey = "name" | "trend" | "qty" | "unit" | "stack";
interface ColSort {
  key: ColKey;
  dir: "asc" | "desc";
}
// Ascending comparator for one List-view column; descending negates the result.
const colCompare = (a: InventoryRow, b: InventoryRow, key: ColKey): number => {
  switch (key) {
    case "name":
      return a.display_name.localeCompare(b.display_name);
    case "trend":
      return (a.delta_7d ?? 0) - (b.delta_7d ?? 0);
    case "qty":
      return a.qty - b.qty;
    case "unit":
      return (a.median_plat ?? 0) - (b.median_plat ?? 0);
    default:
      return realValue(a) - realValue(b);
  }
};

const Tile = memo(function Tile({
  row,
  onOpen,
  listed,
}: {
  row: InventoryRow;
  onOpen: (slug: string) => void;
  listed?: boolean;
}) {
  const plat = row.median_plat;
  return (
    <button
      type="button"
      className={clsx("tile", `t-${tier(plat)}`, row.excluded && "excluded")}
      onClick={() => onOpen(row.slug)}
      title={row.excluded ? `${row.display_name} — excluded from portfolio value` : undefined}
    >
      {row.trend === "up" ? <span className="ct-tl">▲</span> : null}
      {row.is_vaulted ? (
        <span className="lock" title="Vaulted — no longer farmable">
          <Icon name="lock" />
        </span>
      ) : null}
      {listed ? (
        <span className="listed-mark" title="Listed on warframe.market">
          <Icon name="tag" />
        </span>
      ) : null}
      <span className="qty num">×{row.qty}</span>
      {row.thumbnail_url ? (
        <img className="glyph-img" src={row.thumbnail_url} alt="" loading="lazy" />
      ) : (
        <span className="glyph">{glyph(row.display_name)}</span>
      )}
      <div className="vbar">
        {row.confidence && !row.excluded ? (
          <span
            className={clsx("cf-dot", row.confidence)}
            title={`${row.confidence} confidence in value`}
          />
        ) : (
          <span />
        )}
        <span className="pl num">{row.excluded ? "—" : plat == null ? "—" : `${fmt(plat)}p`}</span>
      </div>
      {row.liquidity != null && row.liquidity < 0.95 ? (
        <span
          className="liqbar"
          title={`realizable ${fmt(row.realizable_plat)}p of ${fmt(rowValue(row))}p · ${Math.round(
            row.liquidity * 100,
          )}% liquid${row.days_to_sell != null ? ` · ~${fmt(row.days_to_sell)}d to sell` : ""}`}
        >
          <span className="liqbar-fill" style={{ width: `${Math.max(4, row.liquidity * 100)}%` }} />
        </span>
      ) : null}
      <span className={clsx("trend", trendOf(row.delta_7d))} />
    </button>
  );
});

// Chips view: a wider row card — full item name (ellipsis), part, price + 7d move.
const ChipItem = memo(function ChipItem({
  row,
  onOpen,
  listed,
}: {
  row: InventoryRow;
  onOpen: (slug: string) => void;
  listed?: boolean;
}) {
  const plat = row.median_plat;
  const d = row.delta_7d;
  const up = (d ?? 0) >= 0;
  return (
    <button
      type="button"
      className={clsx("chip-it", `t-${tier(plat)}`, row.excluded && "excluded")}
      onClick={() => onOpen(row.slug)}
      title={
        row.excluded
          ? `${row.display_name} — excluded from portfolio value`
          : `${row.display_name} — ${row.part_type}\n${fmt(plat)} p · ${d == null ? "—" : pct(d)} 7d · ×${row.qty}`
      }
    >
      <span className="ci-gl">
        {row.thumbnail_url ? (
          <img src={row.thumbnail_url} alt="" loading="lazy" />
        ) : (
          glyph(row.display_name)
        )}
      </span>
      <span className="ci-mid">
        <span className="ci-nm">{row.display_name}</span>
        <span className="ci-sub">
          {row.trend === "up" ? <span className="hot">▲ </span> : null}
          {row.excluded ? "excluded · " : ""}
          {row.part_type}
          {row.is_vaulted ? <span className="vault">VAULT</span> : null}
          {listed ? <span className="listed-tag">LISTED</span> : null}
        </span>
      </span>
      <span className="ci-r">
        {row.excluded ? (
          <span className="ci-pl num">—</span>
        ) : (
          <>
            <span className="ci-pl num">
              {plat == null ? "—" : fmt(plat)}
              <span className="u">p</span>
            </span>
            <span className={clsx("ci-d num", d == null ? "muted" : up ? "pos" : "neg")}>
              {d == null ? "—" : `${up ? "+" : ""}${Math.round(d)}%`}
              {row.qty > 1 ? <span className="ci-q"> ×{row.qty}</span> : null}
            </span>
          </>
        )}
      </span>
    </button>
  );
});

// List view: the shared data table — Item | 7d (spark + %) | Qty | Unit | Stack.
const InvTable = memo(function InvTable({
  rows,
  onOpen,
  colSort,
  onSort,
  listed,
}: {
  rows: InventoryRow[];
  onOpen: (slug: string) => void;
  colSort: ColSort | null;
  onSort: (key: ColKey) => void;
  listed: Set<string>;
}) {
  return (
    <table className="dtable inv-tbl">
      <thead>
        <tr>
          <SortTh<ColKey> label="Item" col="name" sort={colSort} onSort={onSort} />
          <SortTh<ColKey> label="7d trend" col="trend" sort={colSort} onSort={onSort} right />
          <SortTh<ColKey> label="Qty" col="qty" sort={colSort} onSort={onSort} right />
          <SortTh<ColKey> label="Unit" col="unit" sort={colSort} onSort={onSort} right />
          <SortTh<ColKey> label="Stack" col="stack" sort={colSort} onSort={onSort} right />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const plat = row.median_plat;
          const d = row.delta_7d;
          const up = d == null ? undefined : d >= 0;
          return (
            <tr
              key={row.slug}
              className={clsx(row.excluded && "excluded")}
              {...rowAction(() => onOpen(row.slug))}
            >
              <td>
                <div className="dnm">
                  <Glyph name={row.display_name} plat={plat} thumb={row.thumbnail_url} />
                  <span className="di">
                    <span className="nm">
                      {row.display_name}
                      {row.trend === "up" ? <span className="hot">▲ HOT</span> : null}
                      {row.excluded ? <span className="excl-tag">EXCL</span> : null}
                      {row.is_vaulted ? <span className="vault">VAULT</span> : null}
                      {listed.has(row.slug) ? <span className="listed-tag">LISTED</span> : null}
                    </span>
                    <span className="sub">{row.part_type}</span>
                  </span>
                </div>
              </td>
              <td className="r">
                <span className="tcell">
                  <Spark data={row.spark} w={56} h={20} up={up} />
                  {d == null ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className={up ? "pos" : "neg"}>
                      {up ? "+" : ""}
                      {Math.round(d)}%
                    </span>
                  )}
                </span>
              </td>
              <td className="r num">×{row.qty}</td>
              <td className="r num">{row.excluded ? "—" : plat == null ? "—" : `${fmt(plat)}p`}</td>
              <td className="r num stk">{row.excluded ? "—" : `${fmt(realValue(row))}p`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

const Section = memo(function Section({
  title,
  rows,
  onOpen,
  view,
  colSort,
  onSort,
  listed,
}: {
  title: string;
  rows: InventoryRow[];
  onOpen: (slug: string) => void;
  view: ViewKey;
  colSort: ColSort | null;
  onSort: (key: ColKey) => void;
  listed: Set<string>;
}) {
  const [open, setOpen] = useState(true);
  const stack = rows.reduce((s, r) => s + realValue(r), 0);
  return (
    <div className="section">
      <div
        className="sec-h"
        // biome-ignore lint/a11y/useSemanticElements: header contains an <h2> — invalid inside a native button
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className={clsx("tw", open && "open")}>▸</span>
        <h2>{title}</h2>
        <span className="ct">{rows.length}</span>
        <span className="tot num">
          stack value <b>{fmt(stack)}p</b>
        </span>
      </div>
      {open ? (
        rows.length === 0 ? (
          <div className="empty">No items match.</div>
        ) : view === "chips" ? (
          <div className="chips">
            {rows.map((r) => (
              <ChipItem key={r.slug} row={r} onOpen={onOpen} listed={listed.has(r.slug)} />
            ))}
          </div>
        ) : view === "list" ? (
          <InvTable rows={rows} onOpen={onOpen} colSort={colSort} onSort={onSort} listed={listed} />
        ) : (
          <div className="grid">
            {rows.map((r) => (
              <Tile key={r.slug} row={r} onOpen={onOpen} listed={listed.has(r.slug)} />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
});

// View-options popover (sliders icon): tile size, label density, magnify toggle.
function ViewOptions({
  size,
  setSize,
  labels,
  setLabels,
  magnify,
  setMagnify,
  hideExcluded,
  setHideExcluded,
}: {
  size: string;
  setSize: (v: string) => void;
  labels: string;
  setLabels: (v: string) => void;
  magnify: boolean;
  setMagnify: (v: boolean) => void;
  hideExcluded: boolean;
  setHideExcluded: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const SIZES: [string, string][] = [
    ["dense", "Compact"],
    ["", "Default"],
    ["tile-lg", "Large"],
  ];
  const LABELS: [string, string][] = [
    ["", "All values"],
    ["labels-hi", "High value only"],
    ["labels-hover", "On hover"],
  ];
  // stopPropagation keeps the panel open across multiple toggles (the window click
  // listener that closes it won't fire). Buttons stay keyboard-accessible.
  const opt = (active: boolean, label: string, apply: () => void) => (
    <button
      key={label}
      type="button"
      className={clsx("viewopt", active && "on")}
      onClick={(e) => {
        e.stopPropagation();
        apply();
      }}
    >
      <span>{label}</span>
      {active ? <span className="ck">✓</span> : null}
    </button>
  );

  return (
    <div className="viewsel">
      <button
        type="button"
        className="viewbtn"
        title="View options"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <Icon name="sliders" />
        <span className="cv">▾</span>
      </button>
      {open ? (
        <div className="viewmenu r">
          <div className="vohead">Tile size</div>
          {SIZES.map(([k, l]) => opt(size === k, l, () => setSize(k)))}
          <div className="vohead vosep">Labels</div>
          {LABELS.map(([k, l]) => opt(labels === k, l, () => setLabels(k)))}
          <div className="vohead vosep">Hover</div>
          {opt(magnify, "Magnify on hover", () => setMagnify(!magnify))}
          <div className="vohead vosep">Excluded mods</div>
          {opt(hideExcluded, "Hide from inventory", () => setHideExcluded(!hideExcluded))}
        </div>
      ) : null}
    </div>
  );
}

export function Inventory({
  onOpen,
  search,
}: {
  onOpen: (slug: string) => void;
  search: string;
}) {
  const { data: inv = [], isLoading, isError } = useInventory();
  const { data: summary } = useSummary();
  // Slugs with an active warframe.market sell order → "LISTED" tag on the tiles.
  const { data: listings = [] } = useListings();
  const listedSlugs = useMemo(() => new Set(listings.map((l) => l.slug)), [listings]);
  const { data: progress } = usePricingProgress();
  const qc = useQueryClient();
  // While the throttled refresh is in flight, the portfolio value climbs as items
  // re-price. Show a "pricing…" note and pull fresh totals so it updates live.
  const pricing = !!progress?.active && progress.priced < progress.total;
  // The progress query already polls (2s active); piggyback off its updates to
  // refresh totals as items get priced and once when the sync ends — no extra
  // timer double-polling on top of it.
  const priced = progress?.priced ?? 0;
  const active = !!progress?.active;
  useEffect(() => {
    if (!active && priced === 0) return; // no sync has happened this session
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
  }, [priced, active, qc]);
  const [cat, setCat] = useState<string>("all");
  const [hot, setHot] = useState(false);
  const [vaulted, setVaulted] = useState(false);
  const [sort, setSort] = usePersisted<SortKey>("wfit-inv-sort", "value-desc");
  // List-view column-header sorting. Clicking a header cycles asc → desc → off;
  // while active it overrides the toolbar sort dropdown (which clears it on change).
  const [colSort, setColSort] = useState<ColSort | null>(null);
  const cycleSort = useCallback((key: ColKey) => {
    setColSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }, []);
  const [view, setView] = usePersisted<ViewKey>("wfit-inv-view", "grid");
  const [size, setSize] = usePersisted<string>("wfit-inv-size", "");
  const [labels, setLabels] = usePersisted<string>("wfit-inv-labels", "");
  const [magnify, setMagnify] = useState(() => {
    try {
      return localStorage.getItem("wfit-inv-magnify") !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("wfit-inv-magnify", magnify ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [magnify]);
  const [hideExcluded, setHideExcludedStr] = usePersisted<"1" | "0">("wfit-inv-hide-excl", "0");
  const hideExcl = hideExcluded === "1";
  const setHideExcluded = (v: boolean) => setHideExcludedStr(v ? "1" : "0");

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    // Hot and Category are independent axes that combine. Search matches name + part + cat.
    const rows = inv.filter((r) => {
      if (hideExcl && r.excluded) return false;
      if (query && !`${r.display_name} ${r.part_type} ${r.category}`.toLowerCase().includes(query))
        return false;
      if (hot && r.trend !== "up") return false;
      if (vaulted && !r.is_vaulted) return false;
      return true;
    });
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (colSort) {
        const c = colCompare(a, b, colSort.key);
        return colSort.dir === "asc" ? c : -c;
      }
      switch (sort) {
        case "value-asc":
          return realValue(a) - realValue(b);
        case "trend":
          return (b.delta_7d ?? 0) - (a.delta_7d ?? 0);
        case "name":
          return a.display_name.localeCompare(b.display_name);
        default:
          return realValue(b) - realValue(a);
      }
    });
    return sorted;
  }, [inv, query, hot, vaulted, sort, colSort, hideExcl]);

  const byCat = useMemo(() => {
    const map = new Map<string, InventoryRow[]>();
    for (const r of filtered) {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    }
    return map;
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: inv.length };
    for (const cc of CATS) c[cc] = inv.filter((r) => r.category === cc).length;
    return c;
  }, [inv]);

  const catOpts: readonly DropdownOption[] = useMemo(
    () => [
      ["all", `All · ${counts.all ?? 0}`],
      ...CATS.map((c) => [c, `${CATEGORY_LABELS[c]} · ${counts[c] ?? 0}`] as DropdownOption),
    ],
    [counts],
  );

  // Section visibility (spec §3.5): hide non-selected categories; hide an emptied
  // section unless a specific category is selected with no hot/query filter.
  const filtering = hot || vaulted || query !== "";
  const visible = CATS.filter((c) => {
    if (cat !== "all" && cat !== c) return false;
    const rows = byCat.get(c) ?? [];
    if (rows.length === 0) return cat === c && !filtering;
    return true;
  });

  return (
    <div className={clsx("inv-root", size, labels, !magnify && "no-magnify")}>
      {pricing && progress ? (
        <div className="pricing-note">
          <span className="spin" />
          syncing prices from warframe.market…{" "}
          <b className="num">
            {fmt(progress.priced)} / {fmt(progress.total)}
          </b>{" "}
          priced — values update as this fills in.
        </div>
      ) : null}
      <div className="statband">
        <StatBox
          k="Realizable Platinum"
          v={`~${fmtK(summary?.realizable_plat)}`}
          unit="p"
          d={`up to ${fmtK(summary?.total_plat)}p at market`}
          dcls="muted"
        />
        <StatBox k="Total Ducats" v={fmt(summary?.total_ducats)} unit="d" />
        <StatBox
          k="Items"
          v={fmt(summary?.part_count)}
          d={`${fmt(summary?.distinct_count)} distinct`}
          dcls="muted"
        />
        <StatBox
          k="Portfolio 7d"
          v={summary?.portfolio_7d == null ? "—" : pct(summary.portfolio_7d)}
          dcls={(summary?.portfolio_7d ?? 0) >= 0 ? "pos" : "neg"}
        />
        <StatBox k="Hot" v={fmt(summary?.hot_count)} />
        <StatBox k="Sold · 7d" v={fmt(summary?.sold_7d)} unit="p" />
      </div>

      <div className="filters">
        <button
          type="button"
          className="chip"
          aria-pressed={hot}
          onClick={() => setHot((h) => !h)}
          title="Show only items trending up"
        >
          ▲ Hot
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={vaulted}
          onClick={() => setVaulted((v) => !v)}
          title="Show only vaulted items (no longer farmable)"
        >
          <Icon name="lock" /> Vaulted
        </button>
        <Dropdown
          icon="filter"
          value={cat}
          options={catOpts}
          onChange={setCat}
          align="left"
          title="Filter by category"
        />
        <span className="sp" />
        <span className="sortlbl">sort</span>
        <Dropdown
          icon="sort"
          value={sort}
          options={SORT_OPTS}
          onChange={(v) => {
            setSort(v as SortKey);
            setColSort(null);
          }}
          align="right"
          title="Sort items"
        />
        <Dropdown
          value={view}
          options={VIEWS}
          onChange={(v) => setView(v as ViewKey)}
          align="right"
          title="Layout"
        />
        <ViewOptions
          size={size}
          setSize={setSize}
          labels={labels}
          setLabels={setLabels}
          magnify={magnify}
          setMagnify={setMagnify}
          hideExcluded={hideExcl}
          setHideExcluded={setHideExcluded}
        />
      </div>

      {isError ? (
        <div className="empty">Couldn't load your inventory. Try again in a moment.</div>
      ) : isLoading ? (
        <div className="empty">Loading inventory…</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          {inv.length === 0 ? (
            <>
              Nothing here yet. Use <b>+ Add items</b> to start tracking what you own.
            </>
          ) : (
            "No items match."
          )}
        </div>
      ) : (
        visible.map((c) => (
          <Section
            key={c}
            title={CATEGORY_LABELS[c]}
            rows={byCat.get(c) ?? []}
            onOpen={onOpen}
            view={view}
            colSort={colSort}
            onSort={cycleSort}
            listed={listedSlugs}
          />
        ))
      )}

      <div className="legend">
        <span className="sw">
          <span className="box" style={{ borderTopColor: "var(--t-exotic)" }} /> 120p+
        </span>
        <span className="sw">
          <span className="box" style={{ borderTopColor: "var(--t-legend)" }} /> 45–119p
        </span>
        <span className="sw">
          <span className="box" style={{ borderTopColor: "var(--t-rare)" }} /> 15–44p
        </span>
        <span className="sw">
          <span className="box" style={{ borderTopColor: "var(--t-basic)" }} /> &lt;15p
        </span>
        <span className="sw">
          {view === "grid"
            ? "▲ hot · bottom bar = 7d trend · ×n owned"
            : "▲ hot · color = value tier"}
        </span>
      </div>
    </div>
  );
}
