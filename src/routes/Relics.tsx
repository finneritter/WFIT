// The Relics browser: every known relic (owned or not) in one full-screen
// spreadsheet, squad-aware drop EV, burn-order default sort, and heavy filters.
// Clicking a row opens the RelicDrawer (per-refinement EV/ROI + drop table).
import { useMemo } from "react";
import { Dropdown } from "../components/Dropdown";
import { Chip, SortTh, TableStatus, rowAction } from "../components/ui";
import { useImportScannedRelics, useRelicBrowser } from "../hooks/queries";
import { useColumnSort } from "../hooks/useTable";
import { clsx, fmt } from "../lib/format";
import { usePersisted } from "../lib/persist";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { relicsSchema } from "../lib/searchSchemas";
import type { RelicBrowserRow } from "../lib/types";

const TIERS = ["Lith", "Meso", "Neo", "Axi", "Requiem"] as const;
const TIER_ORDER: Record<string, number> = Object.fromEntries(TIERS.map((t, i) => [t, i]));
const TIER_OPTIONS = [["all", "All tiers"], ...TIERS.map((t) => [t, t] as const)] as const;
const SQUADS = ["1", "2", "3", "4"] as const;

// Short refinement labels for the owned-stacks sub-line ("Int ×3 · Rad ×2").
const REF_ABBR: Record<string, string> = {
  Intact: "Int",
  Exceptional: "Exc",
  Flawless: "Flw",
  Radiant: "Rad",
};

export type OpenRelicFn = (tier: string, name: string) => void;

type Col = "name" | "tier" | "qty" | "ev" | "rare" | "ducats" | "owned" | "score";
const CMP: Record<Col, (a: RelicBrowserRow, b: RelicBrowserRow) => number> = {
  name: (a, b) => a.display_name.localeCompare(b.display_name),
  tier: (a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9),
  qty: (a, b) => a.qty - b.qty,
  ev: (a, b) => a.ev_plat - b.ev_plat,
  rare: (a, b) => (a.rare_plat ?? -1) - (b.rare_plat ?? -1),
  ducats: (a, b) => a.ducat_ev - b.ducat_ev,
  owned: (a, b) => a.drops_owned - b.drops_owned,
  score: (a, b) => a.score - b.score,
};

// The default "what do I feed the fissure" order: owned-unprotected by burn
// score, then owned-protected (still visible, demoted), then the unowned catalog
// by EV. Protection demotes here — in presentation — so the backend score stays a
// pure priority signal.
function burnOrder(a: RelicBrowserRow, b: RelicBrowserRow): number {
  const group = (r: RelicBrowserRow) => (r.qty > 0 ? (r.protected ? 1 : 0) : 2);
  const ga = group(a);
  const gb = group(b);
  if (ga !== gb) return ga - gb;
  const cmp = ga === 2 ? b.ev_plat - a.ev_plat : b.score - a.score;
  return cmp || a.display_name.localeCompare(b.display_name);
}

type Signal = "set" | "wanted" | "now" | "protected" | "vaulted";
const SIGNAL_CHIPS: [Signal, string, string][] = [
  ["set", "Completes a set", "shows relics that finish a one-away set"],
  ["wanted", "Wanted", "drops a watch/buy-list item"],
  ["now", "Crackable now", "a live fissure matches the tier"],
  ["protected", "Protected", "flagged do-not-burn"],
  ["vaulted", "Vaulted", "no longer farmable"],
];

function matchesSignal(r: RelicBrowserRow, s: Signal): boolean {
  switch (s) {
    case "set":
      return r.sets.length > 0;
    case "wanted":
      return r.wanted;
    case "now":
      return r.crackable_now;
    case "protected":
      return r.protected;
    case "vaulted":
      return r.vaulted;
  }
}

export function Relics({ onOpenRelic }: { onOpenRelic: OpenRelicFn }) {
  const [squadStr, setSquad] = usePersisted<(typeof SQUADS)[number]>("wfit-relic-squad", "1");
  const squad = Number(squadStr) || 1;
  const { data: rows = [], isLoading, isError } = useRelicBrowser(squad);
  const importScan = useImportScannedRelics();
  const search = usePageSearch();

  const [ownedOnly, setOwnedOnly] = usePersisted<"1" | "0">("wfit-relic-owned", "0");
  const [tierFilter, setTierFilter] = usePersisted<string>("wfit-relic-tier", "all");
  const [signals, setSignals] = usePersisted<string>("wfit-relic-signals", "");
  const active = useMemo(() => new Set(signals.split(",").filter(Boolean) as Signal[]), [signals]);
  const toggleSignal = (s: Signal) => {
    const next = new Set(active);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setSignals([...next].join(","));
  };

  const sort = useColumnSort<RelicBrowserRow, Col>("wfit-relic-sort-v2", CMP, null);

  const { test } = useMemo(() => compileQuery(search, relicsSchema), [search]);
  const view = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        test(r) &&
        (ownedOnly === "0" || r.qty > 0) &&
        (tierFilter === "all" || r.tier === tierFilter) &&
        [...active].every((s) => matchesSignal(r, s)),
    );
    // No column sort chosen → burn order (the whole point of the screen).
    return sort.sort ? sort.apply(filtered) : [...filtered].sort(burnOrder);
  }, [rows, test, ownedOnly, tierFilter, active, sort.sort, sort.apply]);

  const totals = useMemo(() => {
    let ownedRelics = 0;
    let ownedQty = 0;
    let ev = 0;
    let ducats = 0;
    for (const r of view) {
      if (r.qty > 0) {
        ownedRelics += 1;
        ownedQty += r.qty;
        ev += r.ev_plat * r.qty;
        ducats += r.ducat_ev * r.qty;
      }
    }
    return { ownedRelics, ownedQty, ev, ducats };
  }, [view]);

  return (
    <div className="rtable-wrap">
      <div className="mkt-filters rtable-filters">
        <Chip
          active={ownedOnly === "1"}
          onClick={() => setOwnedOnly(ownedOnly === "1" ? "0" : "1")}
        >
          Owned
        </Chip>
        <Dropdown value={tierFilter} options={TIER_OPTIONS} onChange={setTierFilter} title="Tier" />
        {SIGNAL_CHIPS.map(([s, label]) => (
          <Chip key={s} active={active.has(s)} onClick={() => toggleSignal(s)}>
            {label}
          </Chip>
        ))}
        <span className="sp" />
        <span
          className="rt-squad"
          title="Squad size — EV becomes best-of-N when friends run the same relic"
        >
          <span className="rt-squad-lbl">Squad</span>
          {SQUADS.map((n) => (
            <Chip key={n} active={squadStr === n} onClick={() => setSquad(n)}>
              {n}
            </Chip>
          ))}
        </span>
        <Chip
          active={importScan.isPending}
          onClick={() => {
            if (!importScan.isPending) importScan.mutate();
          }}
        >
          {importScan.isPending ? "Scanning…" : "Import from game"}
        </Chip>
      </div>

      <div className="rtable-scroll">
        <table className="dtable rtable">
          <thead>
            <tr>
              <SortTh<Col> label="Relic" col="name" sort={sort.sort} onSort={sort.cycle} />
              <SortTh<Col> label="Tier" col="tier" sort={sort.sort} onSort={sort.cycle} />
              <SortTh<Col> label="Qty" col="qty" sort={sort.sort} onSort={sort.cycle} right />
              <SortTh<Col>
                label={squad > 1 ? `EV ×${squad}p` : "EV / crack"}
                col="ev"
                sort={sort.sort}
                onSort={sort.cycle}
                right
              />
              <SortTh<Col>
                label="Rare drop"
                col="rare"
                sort={sort.sort}
                onSort={sort.cycle}
                right
              />
              <SortTh<Col> label="Ducats" col="ducats" sort={sort.sort} onSort={sort.cycle} right />
              <SortTh<Col>
                label="Drops owned"
                col="owned"
                sort={sort.sort}
                onSort={sort.cycle}
                right
              />
              <SortTh<Col> label="Priority" col="score" sort={sort.sort} onSort={sort.cycle} />
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || view.length === 0 ? (
              <TableStatus
                span={8}
                loading={isLoading}
                error={isError}
                emptyText={
                  rows.length === 0
                    ? "No relic data yet. Run “Update game data” in Settings to fetch the relic tables."
                    : "No relics match the current filters."
                }
              />
            ) : (
              view.map((r) => (
                <RelicRow key={`${r.tier}-${r.relic_name}`} r={r} onOpenRelic={onOpenRelic} />
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={8}>
                <span className="num">{fmt(view.length)}</span> relics ·{" "}
                <span className="num">{fmt(totals.ownedRelics)}</span> owned (
                <span className="num">×{fmt(totals.ownedQty)}</span>) · expected{" "}
                <span className="num">~{fmt(Math.round(totals.ev))}p</span> ·{" "}
                <span className="num ducat">~{fmt(Math.round(totals.ducats))}</span> ducats
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function RelicRow({ r, onOpenRelic }: { r: RelicBrowserRow; onOpenRelic: OpenRelicFn }) {
  const scanned = r.stacks.some((s) => s.source === "de_scan");
  const stackLine = r.stacks
    .map((s) => `${REF_ABBR[s.refinement] ?? s.refinement} ×${s.qty}`)
    .join(" · ");
  return (
    <tr
      className={clsx("rt-row", r.qty === 0 && "rt-unowned", r.protected && "rt-protected")}
      {...rowAction(() => onOpenRelic(r.tier, r.relic_name))}
    >
      <td>
        <span className="di">
          <span className="nm">
            {r.display_name}
            {r.vaulted ? (
              <span className="vault" title="vaulted relic — no longer farmable">
                VAULT
              </span>
            ) : null}
            {r.protected ? (
              <span className="prot" title="protected — flagged do-not-burn">
                PROT
              </span>
            ) : null}
            {scanned ? (
              <span className="src-tag src-scan" title="imported from the game">
                SCAN
              </span>
            ) : null}
          </span>
          <span className="sub">
            {r.qty > 0 ? (
              stackLine
            ) : r.best_reward ? (
              <>
                best: {r.best_reward}
                {r.best_reward_plat != null ? ` · ${fmt(r.best_reward_plat)}p` : ""}
              </>
            ) : (
              <span className="muted">no priced drops</span>
            )}
          </span>
        </span>
      </td>
      <td className={clsx("relic-tier", r.tier.toLowerCase())}>{r.tier}</td>
      <td className={clsx("r num", r.qty === 0 && "muted")}>×{r.qty}</td>
      <td className={clsx("r num", r.ev_plat === 0 && "muted")}>~{fmt(Math.round(r.ev_plat))}p</td>
      <td className="r num">
        {r.rare_plat != null ? (
          <span className="rt-rare" title={r.rare_reward ?? undefined}>
            {fmt(r.rare_plat)}p
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className={clsx("r num", r.ducat_ev === 0 && "muted")}>{fmt(Math.round(r.ducat_ev))}</td>
      <td className={clsx("r num", r.drops_total === 0 && "muted")}>
        {r.drops_total > 0 ? (
          <span className={clsx(r.drops_owned === r.drops_total && "pos")}>
            {r.drops_owned}/{r.drops_total}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td>
        <span className="rt-signals">
          {r.sets.length > 0 ? <span className="crk-badge set">SET</span> : null}
          {r.wanted ? <span className="crk-badge wanted">WANTED</span> : null}
          {r.crackable_now ? <span className="crk-badge now">NOW</span> : null}
        </span>
      </td>
    </tr>
  );
}
