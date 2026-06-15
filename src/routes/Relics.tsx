import { useMemo, useState } from "react";
import { Chip, Scrim, SortTh, StatBox, TableStatus, rowAction } from "../components/ui";
import {
  useAddRelic,
  useCrackNow,
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
import { relicsSchema } from "../lib/searchSchemas";
import type { RelicRow } from "../lib/types";

const REFINEMENTS = ["Intact", "Exceptional", "Flawless", "Radiant"] as const;
const stackValue = (r: RelicRow) => r.ev_plat * r.qty;

type Col = "name" | "tier" | "qty" | "ev" | "value";
const CMP: Record<Col, (a: RelicRow, b: RelicRow) => number> = {
  name: (a, b) => a.display_name.localeCompare(b.display_name),
  tier: (a, b) => a.tier.localeCompare(b.tier),
  qty: (a, b) => a.qty - b.qty,
  ev: (a, b) => a.ev_plat - b.ev_plat,
  value: (a, b) => stackValue(a) - stackValue(b),
};

export function Relics() {
  const { data: relics = [], isLoading, isError } = useRelics();
  const search = usePageSearch();
  const [adding, setAdding] = useState(false);
  const importScan = useImportScannedRelics();
  const setQty = useSetRelicQty();
  const removeRelic = useRemoveRelic();
  const sort = useColumnSort<RelicRow, Col>("wfit-relic-sort", CMP, { key: "value", dir: "desc" });

  const { test } = useMemo(() => compileQuery(search, relicsSchema), [search]);
  const view = useMemo(() => sort.apply(relics.filter(test)), [relics, test, sort.apply]);

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

      <CrackNowBanner />

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
                        {r.source === "de_scan" ? (
                          <span className="src-tag" title="imported from the game">
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
      </div>

      {adding ? <AddRelicModal onClose={() => setAdding(false)} /> : null}
    </>
  );
}

// A live "crack now" summary at the top of the Relics screen (mirrors the Rotation
// panel) — relics you own that a live fissure can crack, wanted drops flagged.
function CrackNowBanner() {
  const { data: rows = [] } = useCrackNow();
  if (rows.length === 0) return null;
  const wanted = rows.filter((r) => r.wanted_drops.length > 0);
  return (
    <div className="crack-banner">
      <b>Crackable now:</b> {rows.length} owned relic{rows.length === 1 ? "" : "s"} match a live
      fissure
      {wanted.length > 0 ? (
        <span className="pos"> · {wanted.length} can drop something you want</span>
      ) : null}
      .
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
