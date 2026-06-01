import { useMemo, useState } from "react";
import { StatBox } from "../components/ui";
import { useInventory, useSummary } from "../hooks/queries";
import { CATEGORY_LABELS, clsx, fmt, glyph, pct, tier, trendOf } from "../lib/format";
import type { InventoryRow } from "../lib/types";

type SortKey = "value-desc" | "value-asc" | "trend" | "name";
const CATS = ["warframe", "weapon", "set", "mod", "arcane"] as const;

// Full market value of a row (the optimistic "ceiling"): rank-aware value_plat for
// mods/arcanes, else median × qty.
const rowValue = (r: InventoryRow) => r.value_plat ?? (r.median_plat ?? 0) * r.qty;
// Liquidation-adjusted value — the honest worth. Drives totals + sort so illiquid
// hoards sink instead of inflating the inventory.
const realValue = (r: InventoryRow) => r.realizable_plat ?? rowValue(r);

function Tile({ row, onOpen }: { row: InventoryRow; onOpen: (slug: string) => void }) {
  const plat = row.median_plat;
  return (
    <button
      type="button"
      className={clsx("tile", `t-${tier(plat)}`)}
      onClick={() => onOpen(row.slug)}
    >
      {row.trend === "up" ? <span className="ct-tl">▲</span> : null}
      <span className="qty num">×{row.qty}</span>
      {row.thumbnail_url ? (
        <img className="glyph-img" src={row.thumbnail_url} alt="" loading="lazy" />
      ) : (
        <span className="glyph">{glyph(row.display_name)}</span>
      )}
      <div className="vbar">
        <span className="pl num">{plat == null ? "—" : `${fmt(plat)}p`}</span>
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
}

function Section({
  title,
  rows,
  onOpen,
}: {
  title: string;
  rows: InventoryRow[];
  onOpen: (slug: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const stack = rows.reduce((s, r) => s + realValue(r), 0);
  return (
    <div className="section">
      <div className="sec-h" onClick={() => setOpen((o) => !o)}>
        <span className="tw">{open ? "▾" : "▸"}</span>
        <h2>{title}</h2>
        <span className="ct">{rows.length}</span>
        <span className="tot num">
          stack value <b>{fmt(stack)}p</b>
        </span>
      </div>
      {open ? (
        <div className="grid">
          {rows.map((r) => (
            <Tile key={r.slug} row={r} onOpen={onOpen} />
          ))}
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
  const { data: inv = [], isLoading } = useInventory();
  const { data: summary } = useSummary();
  const [cat, setCat] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("value-desc");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = inv.filter((r) => !q || r.display_name.toLowerCase().includes(q));
    if (cat === "hot") rows = rows.filter((r) => r.trend === "up");
    else if (cat !== "all") rows = rows.filter((r) => r.category === cat);
    const sorted = [...rows];
    sorted.sort((a, b) => {
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
  }, [inv, search, cat, sort]);

  const sections = useMemo(() => {
    const map = new Map<string, InventoryRow[]>();
    for (const r of filtered) {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    }
    return CATS.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: inv.length,
      hot: inv.filter((r) => r.trend === "up").length,
    };
    for (const cat of CATS) c[cat] = inv.filter((r) => r.category === cat).length;
    return c;
  }, [inv]);

  return (
    <>
      <div className="statband">
        <StatBox
          k="Realizable Platinum"
          v={fmt(summary?.realizable_plat)}
          unit="p"
          d={`≈ ${fmt(summary?.total_plat)}p at market`}
          dcls="muted"
        />
        <StatBox k="Total Ducats" v={fmt(summary?.total_ducats)} unit="d" />
        <StatBox
          k="Parts"
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
        {(["all", "hot", ...CATS] as const).map((c) => (
          <button
            key={c}
            type="button"
            className="chip"
            aria-pressed={cat === c}
            onClick={() => setCat(c)}
          >
            {c === "all" ? "All" : c === "hot" ? "Hot" : CATEGORY_LABELS[c]}
            <span className="n">{counts[c] ?? 0}</span>
          </button>
        ))}
        <span className="sp" />
        <span className="sortlbl">sort</span>
        {(
          [
            ["value-desc", "Value ▾"],
            ["value-asc", "Value ▴"],
            ["trend", "Trend ▾"],
            ["name", "Name"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className="chip"
            aria-pressed={sort === k}
            onClick={() => setSort(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="empty">Loading inventory…</div>
      ) : sections.length === 0 ? (
        <div className="empty">
          Nothing here yet. Use <b>+ Add items</b> to start tracking what you own.
        </div>
      ) : (
        sections.map(([c, rows]) => (
          <Section key={c} title={CATEGORY_LABELS[c]} rows={rows} onOpen={onOpen} />
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
        <span className="sw">▲ trending up</span>
      </div>
    </>
  );
}
