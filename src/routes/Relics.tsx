import { Fragment, useMemo, useState } from "react";
import type { ScreenId } from "../components/Sidebar";
import { Chip, Scrim, SortTh, StatBox, TableStatus, rowAction } from "../components/ui";
import {
  useAddRelic,
  useCrackPlan,
  useImportScannedRelics,
  useRelicChoices,
  useRelics,
  useRemoveRelic,
  useSetRelicQty,
} from "../hooks/queries";
import { useEscape } from "../hooks/useEscape";
import { useColumnSort } from "../hooks/useTable";
import { clsx, fmt } from "../lib/format";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { crackPlanSchema, relicsSchema } from "../lib/searchSchemas";
import type { CrackPlanRow, RelicRow } from "../lib/types";

const REFINEMENTS = ["Intact", "Exceptional", "Flawless", "Radiant"] as const;
const stackValue = (r: RelicRow) => r.ev_plat * r.qty;

const TABS = [
  ["crack", "To crack"],
  ["all", "All relics"],
] as const;
type TabId = (typeof TABS)[number][0];

type NavFn = (s: ScreenId, opts?: { focusSetSlug?: string }) => void;
type OpenFn = (slug: string) => void;

export function Relics({ onOpen, onNavigate }: { onOpen: OpenFn; onNavigate: NavFn }) {
  const { data: relics = [] } = useRelics();
  const [tab, setTab] = useState<TabId>("crack");

  const totalEv = relics.reduce((s, r) => s + stackValue(r), 0);
  const totalQty = relics.reduce((s, r) => s + r.qty, 0);
  const best = relics.reduce<RelicRow | null>(
    (b, r) => (b == null || stackValue(r) > stackValue(b) ? r : b),
    null,
  );

  return (
    <>
      <div className="statband">
        <StatBox
          k="Expected value"
          v={`~${fmt(Math.round(totalEv))}`}
          unit="p"
          d="sum of drop EV"
          dcls="muted"
        />
        <StatBox k="Relics" v={fmt(totalQty)} d={`${fmt(relics.length)} distinct`} dcls="muted" />
        <StatBox
          k="Best holding"
          v={best ? best.display_name : "—"}
          d={best ? `~${fmt(Math.round(stackValue(best)))}p` : undefined}
          dcls="muted"
        />
      </div>

      <div className="rot-tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="chip"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "crack" ? <CrackTab onOpen={onOpen} onNavigate={onNavigate} /> : <AllRelicsTab />}
    </>
  );
}

// ---------------------------------------------------------------------------
// "To crack" — owned relics worth cracking next, ranked by combined priority.
// ---------------------------------------------------------------------------

const HIGH_VALUE = 15; // matches backend MIN_EV_PLAT
type CrackFilter = "now" | "set" | "value";
const FILTERS: [CrackFilter, string][] = [
  ["set", "Completes a set"],
  ["value", "High value"],
  ["now", "Crackable now"],
];

type Reason = { label: string; cls: string };
// The why-crack reasons that put a relic on the list, highest priority first (mirrors
// the backend score). Vaulted is NOT here — it's a separate informational tag.
function reasonsOf(r: CrackPlanRow): Reason[] {
  const out: Reason[] = [];
  if (r.sets.length > 0) out.push({ label: "COMPLETES SET", cls: "set" });
  if (r.drops.some((d) => d.wanted)) out.push({ label: "WANTED", cls: "wanted" });
  if (r.ev_plat >= HIGH_VALUE) out.push({ label: "HIGH VALUE", cls: "value" });
  if (r.crackable_now) out.push({ label: "CRACKABLE NOW", cls: "now" });
  return out;
}

// The expanded detail under a relic row: why it's worth cracking (with set backlinks) +
// its full drop table (reward names link to the item Drawer, set parts to the Sets page).
function CrackDetail({
  r,
  onOpen,
  onNavigate,
}: {
  r: CrackPlanRow;
  onOpen: OpenFn;
  onNavigate: NavFn;
}) {
  const wantedDrops = r.drops.filter((d) => d.wanted).map((d) => d.reward_name);
  return (
    <div className="crk-detail">
      <ul className="crk-why">
        {r.sets.map((s) => (
          <li key={s.slug}>
            Completes{" "}
            <button
              type="button"
              className="crk-link"
              onClick={() => onNavigate("sets", { focusSetSlug: s.slug })}
            >
              {s.name} →
            </button>{" "}
            <span className="muted">(one part away)</span>
          </li>
        ))}
        {wantedDrops.length > 0 ? (
          <li>
            <b>On your watch/buy list</b> — drops {wantedDrops.join(", ")}
          </li>
        ) : null}
        {r.crackable_now ? (
          <li>
            <b>Crackable now</b> — a live fissure of this tier is up
          </li>
        ) : null}
        {r.relic_vaulted ? (
          <li className="muted">Vaulted relic — no longer drops from fissures</li>
        ) : null}
      </ul>
      <table className="crk-dtbl">
        <thead>
          <tr>
            <th>Drop · {r.refinement}</th>
            <th className="r">Chance</th>
            <th className="r">Value</th>
          </tr>
        </thead>
        <tbody>
          {r.drops.map((d) => (
            <tr className={clsx("crk-drop-row", (d.wanted || d.set) && "hot")} key={d.reward_name}>
              <td>
                <span className="cd-mark">{d.set ? "◆" : d.wanted ? "★" : ""}</span>
                {d.reward_slug ? (
                  <button type="button" className="crk-link" onClick={() => onOpen(d.reward_slug!)}>
                    {d.reward_name}
                  </button>
                ) : (
                  <span className="cd-nm">{d.reward_name}</span>
                )}
                {d.set && d.set_slug ? (
                  <button
                    type="button"
                    className="crk-setlink"
                    title="Go to this set"
                    onClick={() => onNavigate("sets", { focusSetSlug: d.set_slug! })}
                  >
                    → set
                  </button>
                ) : null}
              </td>
              <td className="r num">{d.chance.toFixed(1)}%</td>
              <td className="r num">{d.plat != null ? `${fmt(d.plat)}p` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CrackTab({ onOpen, onNavigate }: { onOpen: OpenFn; onNavigate: NavFn }) {
  const { data: rows = [], isLoading, isError } = useCrackPlan();
  const search = usePageSearch();
  const [filters, setFilters] = useState<Set<CrackFilter>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());

  const { test } = useMemo(() => compileQuery(search, crackPlanSchema), [search]);
  const view = useMemo(
    () =>
      rows.filter(
        (r) =>
          test(r) &&
          (!filters.has("now") || r.crackable_now) &&
          (!filters.has("set") || r.sets.length > 0) &&
          (!filters.has("value") || r.ev_plat >= HIGH_VALUE),
      ),
    [rows, test, filters],
  );

  const toggleFilter = (f: CrackFilter) =>
    setFilters((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  const toggleOpen = (k: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Best relics to crack next</h3>
        <span className="meta">
          relics that finish a set you're one part from, drop an item you want, or return ≥
          {HIGH_VALUE}p a crack. Click a relic for its drops.
        </span>
      </div>
      <div className="mkt-filters" style={{ margin: "0 0 10px" }}>
        {FILTERS.map(([f, label]) => (
          <Chip key={f} active={filters.has(f)} onClick={() => toggleFilter(f)}>
            {label}
          </Chip>
        ))}
      </div>
      <table className="dtable crk-tbl">
        <thead>
          <tr>
            <th>Relic</th>
            <th>Tier</th>
            <th className="r">Qty</th>
            <th className="r">EV / relic</th>
            <th className="r">Value</th>
          </tr>
        </thead>
        <tbody>
          {isLoading || isError || view.length === 0 ? (
            <TableStatus
              span={5}
              loading={isLoading}
              error={isError}
              emptyText={
                rows.length === 0
                  ? "Nothing to prioritize yet. Get one part away from a set, add items to your watch/buy list, or hold a high-value relic — matching relics show up here."
                  : "No relics match the current filters."
              }
            />
          ) : (
            view.map((r) => {
              const key = `${r.tier}-${r.relic_name}-${r.refinement}`;
              const isOpen = open.has(key);
              const reasons = reasonsOf(r);
              return (
                <Fragment key={key}>
                  <tr
                    className={clsx("crk-row", isOpen && "open")}
                    {...rowAction(() => toggleOpen(key))}
                  >
                    <td>
                      <span className="crk-name">
                        <span className="tw">{isOpen ? "▾" : "▸"}</span>
                        <span className="nm">{r.display_name}</span>
                        {reasons[0] ? (
                          <span className={clsx("crk-badge", reasons[0].cls)}>
                            {reasons[0].label}
                          </span>
                        ) : null}
                        {reasons.length > 1 ? (
                          <span className="crk-more">+{reasons.length - 1}</span>
                        ) : null}
                        {r.relic_vaulted ? (
                          <span className="vault" title="vaulted relic — no longer farmable">
                            VAULT
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className={clsx("relic-tier", r.tier.toLowerCase())}>{r.tier}</td>
                    <td className="r num">×{r.qty}</td>
                    <td className="r num">~{fmt(Math.round(r.ev_plat))}p</td>
                    <td className="r num stk">~{fmt(Math.round(r.ev_plat * r.qty))}p</td>
                  </tr>
                  {isOpen ? (
                    <tr className="crk-detail-row">
                      <td colSpan={5}>
                        <CrackDetail r={r} onOpen={onOpen} onNavigate={onNavigate} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "All relics" — the full owned table (manual add / qty / game import).
// ---------------------------------------------------------------------------

type Col = "name" | "tier" | "qty" | "ev" | "value";
const CMP: Record<Col, (a: RelicRow, b: RelicRow) => number> = {
  name: (a, b) => a.display_name.localeCompare(b.display_name),
  tier: (a, b) => a.tier.localeCompare(b.tier),
  qty: (a, b) => a.qty - b.qty,
  ev: (a, b) => a.ev_plat - b.ev_plat,
  value: (a, b) => stackValue(a) - stackValue(b),
};

function AllRelicsTab() {
  const { data: relics = [], isLoading, isError } = useRelics();
  const search = usePageSearch();
  const [adding, setAdding] = useState(false);
  const importScan = useImportScannedRelics();
  const setQty = useSetRelicQty();
  const removeRelic = useRemoveRelic();
  const sort = useColumnSort<RelicRow, Col>("wfit-relic-sort", CMP, { key: "value", dir: "desc" });

  const { test } = useMemo(() => compileQuery(search, relicsSchema), [search]);
  const view = useMemo(() => sort.apply(relics.filter(test)), [relics, test, sort.apply]);

  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Your relics — expected value by drop</h3>
        <span className="meta">
          relics aren't traded; worth = Σ (drop chance × the drop's market price)
        </span>
      </div>
      <div className="mkt-filters" style={{ margin: "0 0 10px" }}>
        <Chip active={adding} onClick={() => setAdding(true)}>
          + Add relic
        </Chip>
        <Chip
          active={importScan.isPending}
          onClick={() => {
            if (!importScan.isPending) importScan.mutate();
          }}
        >
          {importScan.isPending ? "Scanning…" : "Import from game"}
        </Chip>
      </div>
      <table className="dtable">
        <thead>
          <tr>
            <SortTh<Col> label="Relic" col="name" sort={sort.sort} onSort={sort.cycle} />
            <SortTh<Col> label="Tier" col="tier" sort={sort.sort} onSort={sort.cycle} />
            <SortTh<Col> label="Qty" col="qty" sort={sort.sort} onSort={sort.cycle} right />
            <th>Best drop</th>
            <SortTh<Col> label="EV / relic" col="ev" sort={sort.sort} onSort={sort.cycle} right />
            <SortTh<Col> label="Value" col="value" sort={sort.sort} onSort={sort.cycle} right />
            <th />
          </tr>
        </thead>
        <tbody>
          {isLoading || isError || view.length === 0 ? (
            <TableStatus
              span={7}
              loading={isLoading}
              error={isError}
              emptyText="No relics tracked yet. Add one, or import from a running game."
            />
          ) : (
            view.map((r) => (
              <tr key={`${r.tier}-${r.relic_name}-${r.refinement}`}>
                <td>
                  <span className="di">
                    <span className="nm">
                      {r.display_name}
                      {r.relic_vaulted ? (
                        <span className="vault" title="vaulted relic — no longer farmable">
                          VAULT
                        </span>
                      ) : null}
                      {r.source === "de_scan" ? (
                        <span className="src-tag src-scan" title="imported from the game">
                          SCAN
                        </span>
                      ) : null}
                    </span>
                    <span className="sub">
                      {r.refinement} · {r.priced_drops}/{r.total_drops} drops priced
                    </span>
                  </span>
                </td>
                <td className={clsx("relic-tier", r.tier.toLowerCase())}>{r.tier}</td>
                <td className="r num">
                  <span className="qty-step">
                    <button
                      type="button"
                      className="qb"
                      title="Remove one"
                      onClick={() =>
                        setQty.mutate({
                          tier: r.tier,
                          name: r.relic_name,
                          refinement: r.refinement,
                          qty: r.qty - 1,
                        })
                      }
                    >
                      −
                    </button>
                    <b>×{r.qty}</b>
                    <button
                      type="button"
                      className="qb"
                      title="Add one"
                      onClick={() =>
                        setQty.mutate({
                          tier: r.tier,
                          name: r.relic_name,
                          refinement: r.refinement,
                          qty: r.qty + 1,
                        })
                      }
                    >
                      +
                    </button>
                  </span>
                </td>
                <td className="sub">
                  {r.best_reward ? (
                    <>
                      {r.best_reward}
                      {r.best_reward_plat != null ? (
                        <span className="muted"> · {fmt(r.best_reward_plat)}p</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted">no priced drops</span>
                  )}
                </td>
                <td className="r num">~{fmt(Math.round(r.ev_plat))}p</td>
                <td className="r num stk">~{fmt(Math.round(stackValue(r)))}p</td>
                <td className="r">
                  <button
                    type="button"
                    className="x"
                    title="Remove relic"
                    onClick={() =>
                      removeRelic.mutate({
                        tier: r.tier,
                        name: r.relic_name,
                        refinement: r.refinement,
                      })
                    }
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {adding ? <AddRelicModal onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

// Searchable picker over every known relic. Adds one (Intact) per click.
function AddRelicModal({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const { data: choices = [], isLoading } = useRelicChoices();
  const addRelic = useAddRelic();
  const [q, setQ] = useState("");
  const [refinement, setRefinement] = useState<(typeof REFINEMENTS)[number]>("Intact");

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? choices.filter((c) => c.display_name.toLowerCase().includes(needle))
      : choices;
    return list.slice(0, 200);
  }, [choices, q]);

  return (
    <Scrim onClose={onClose}>
      <div className="modal lf-modal">
        <div className="modal-h">
          <h2>Add relic</h2>
          <span style={{ flex: 1 }} />
          <button type="button" className="x" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="mkt-filters" style={{ margin: "0 0 8px" }}>
          {REFINEMENTS.map((rf) => (
            <Chip key={rf} active={refinement === rf} onClick={() => setRefinement(rf)}>
              {rf}
            </Chip>
          ))}
        </div>
        <div className="search" style={{ margin: "0 0 8px" }}>
          <input
            placeholder="Search relics… e.g. Axi A1"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        <div className="np-list">
          <table className="dtable">
            <tbody>
              {isLoading || matches.length === 0 ? (
                <TableStatus
                  span={2}
                  loading={isLoading}
                  error={false}
                  emptyText="No relics match."
                />
              ) : (
                matches.map((c) => (
                  <tr
                    key={`${c.tier}-${c.relic_name}`}
                    {...rowAction(() =>
                      addRelic.mutate({ tier: c.tier, name: c.relic_name, refinement }),
                    )}
                    title={`Add ${c.display_name} (${refinement})`}
                  >
                    <td>
                      <span className="nm">{c.display_name}</span>
                    </td>
                    <td className="r muted">add +1</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Scrim>
  );
}
