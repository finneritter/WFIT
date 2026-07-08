// The relic drawer: per-refinement economics (squad-aware EV, radshare odds,
// refine-or-not ROI) + the full drop table with ownership. Opens from any row in
// the Relics browser; drop names click through to the item Drawer, which stacks
// on top (this drawer's Escape is gated off while it does — see `active`).
import { useMemo, useState } from "react";
import { useRelicDetail, useSetRelicProtected, useSetRelicQty } from "../hooks/queries";
import { useDrawerResize } from "../hooks/useDrawerResize";
import { useEscape } from "../hooks/useEscape";
import { clsx, fmt } from "../lib/format";
import { usePersisted } from "../lib/persist";
import type { RelicRefinementInfo } from "../lib/types";
import type { ScreenId } from "./Sidebar";
import { Chip, Scrim } from "./ui";

const REF_ABBR: Record<string, string> = {
  Intact: "Int",
  Exceptional: "Exc",
  Flawless: "Flw",
  Radiant: "Rad",
};

/// Narrowest the drawer can be dragged: below this the refinement table (6 cols
/// + qty steppers) crushes and wraps. Tables also scroll sideways past this.
const MIN_WIDTH = 480;

export function RelicDrawer({
  tier,
  name,
  active,
  onClose,
  onOpen,
  onNavigate,
}: {
  tier: string;
  name: string;
  /** false while the item Drawer is stacked on top — gates Escape + scrim close. */
  active: boolean;
  onClose: () => void;
  onOpen: (slug: string) => void;
  onNavigate: (s: ScreenId, opts?: { focusSetSlug?: string }) => void;
}) {
  const [squadStr] = usePersisted("wfit-relic-squad", "1");
  const squad = Number(squadStr) || 1;
  const { data: d, isError } = useRelicDetail(tier, name, squad);
  const setQty = useSetRelicQty();
  const setProtected = useSetRelicProtected();
  const [chanceRef, setChanceRef] = useState<string | null>(null);
  useEscape(active ? onClose : () => {});

  // Resizable width — same affordance as the item Drawer, own persistence key.
  const { width, startResize } = useDrawerResize("wfit.relicDrawerWidth", MIN_WIDTH, 520);

  const refinements = d?.refinements ?? [];
  // Chance column defaults to what you'd actually hold: the best owned
  // refinement, else Intact (falling back to whatever table exists).
  const shownRef =
    chanceRef ??
    [...refinements].reverse().find((r) => r.owned_qty > 0)?.refinement ??
    refinements[0]?.refinement ??
    "Intact";
  const chanceAt = (chances: { refinement: string; chance: number }[]) =>
    chances.find((c) => c.refinement === shownRef)?.chance ?? null;

  // The refine verdict: the refinement with the best plat-per-100-traces, if any
  // tier actually beats Intact.
  const verdict = useMemo(() => {
    const candidates = refinements.filter(
      (r): r is RelicRefinementInfo & { plat_per_100_traces: number } =>
        r.plat_per_100_traces != null,
    );
    if (candidates.length === 0) return null;
    const best = candidates.reduce((a, b) =>
      b.plat_per_100_traces > a.plat_per_100_traces ? b : a,
    );
    return best.plat_per_100_traces > 0 ? best : null;
  }, [refinements]);

  const grip = (
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only resize affordance (no keyboard equivalent)
    <div
      className="drawer-grip"
      style={{ right: width }}
      onPointerDown={startResize}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize"
    />
  );

  if (!d) {
    return (
      <Scrim className="scrim" onClose={onClose}>
        {grip}
        <div className="drawer" style={{ width }}>
          <div className="drawer-h">
            <div className="di">
              <div className="nm">{isError ? "Couldn't load this relic." : "Loading…"}</div>
            </div>
            <button type="button" className="x" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
      </Scrim>
    );
  }

  const owned = d.stacks.reduce((s, x) => s + x.qty, 0);

  return (
    <Scrim className="scrim" onClose={active ? onClose : () => {}}>
      {grip}
      <div className="drawer" style={{ width }}>
        <div className="drawer-h">
          <div className="di">
            <div className="nm">
              {d.display_name}
              {d.vaulted ? (
                <span className="vault" title="vaulted relic — no longer farmable">
                  VAULT
                </span>
              ) : null}
              {d.aya ? (
                <span
                  className="aya-tag"
                  title="in Varzia's current Prime Resurgence stock — buyable for Aya"
                >
                  AYA
                </span>
              ) : null}
              {d.protected ? (
                <span className="prot" title="protected — flagged do-not-burn">
                  PROT
                </span>
              ) : null}
            </div>
            <div className="sub">
              {d.tier} relic · you own ×{owned}
              {squad > 1 ? ` · EV as best-of-${squad} radshare` : ""}
            </div>
          </div>
          <button type="button" className="x" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <div className="mkt-filters" style={{ margin: "0 0 10px" }}>
            <Chip
              active={d.protected}
              onClick={() =>
                setProtected.mutate({ tier: d.tier, name: d.relic_name, protected: !d.protected })
              }
            >
              {d.protected ? "⛨ Protected" : "Protect (do not burn)"}
            </Chip>
          </div>

          {/* Per-refinement economics. Requiem relics may list only Intact. */}
          <div className="rankbox">
            <div className="rankbox-h">
              <b>By refinement</b>
              <span className="muted">
                {" "}
                · EV{squad > 1 ? ` (squad of ${squad})` : ""} · rare odds · refine ROI
              </span>
            </div>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-scrollable overflow region */}
            <div className="rd-scroll" tabIndex={0}>
              <table className="dtable rd-ref">
                <thead>
                  <tr>
                    <th>Refinement</th>
                    <th className="r">Owned</th>
                    <th className="r">EV</th>
                    <th className="r">Ducats</th>
                    <th className="r">Rare</th>
                    <th className="r" title="EV gained over Intact per 100 traces spent">
                      p/100tr
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {refinements.map((r) => (
                    <tr key={r.refinement}>
                      <td>{r.refinement}</td>
                      <td className="r num">
                        <span className="qty-step">
                          <button
                            type="button"
                            className="qb"
                            title="Remove one"
                            disabled={r.owned_qty === 0}
                            onClick={() =>
                              setQty.mutate({
                                tier: d.tier,
                                name: d.relic_name,
                                refinement: r.refinement,
                                qty: r.owned_qty - 1,
                              })
                            }
                          >
                            −
                          </button>
                          <b>×{r.owned_qty}</b>
                          <button
                            type="button"
                            className="qb"
                            title="Add one"
                            onClick={() =>
                              setQty.mutate({
                                tier: d.tier,
                                name: d.relic_name,
                                refinement: r.refinement,
                                qty: r.owned_qty + 1,
                              })
                            }
                          >
                            +
                          </button>
                        </span>
                      </td>
                      <td className="r num">
                        ~{fmt(Math.round(r.ev_plat))}p
                        {squad > 1 ? (
                          <span className="muted"> ({fmt(Math.round(r.ev_solo))} solo)</span>
                        ) : null}
                      </td>
                      <td className="r num ducat">{fmt(Math.round(r.ducat_ev))}</td>
                      <td className="r num">{(r.p_rare * 100).toFixed(1)}%</td>
                      <td
                        className={clsx(
                          "r num",
                          r.plat_per_100_traces != null &&
                            (r.plat_per_100_traces > 0 ? "pos" : "neg"),
                        )}
                      >
                        {r.plat_per_100_traces != null ? fmt1(r.plat_per_100_traces) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sub" style={{ padding: "6px 2px 0" }}>
              {verdict
                ? `Refining to ${verdict.refinement} pays best here: +${fmt1(
                    verdict.ev_delta ?? 0,
                  )}p EV for ${verdict.trace_cost} traces.`
                : refinements.length > 1
                  ? "Not worth refining — no tier beats Intact at current prices."
                  : null}
            </div>
          </div>

          {/* Drop table with ownership; names open the item Drawer on top. */}
          <div className="rankbox">
            <div className="rankbox-h">
              <b>Drops</b>
              <span className="muted"> · chance at</span>
              <span className="rd-refsel">
                {refinements.map((r) => (
                  <Chip
                    key={r.refinement}
                    active={shownRef === r.refinement}
                    onClick={() => setChanceRef(r.refinement)}
                  >
                    {REF_ABBR[r.refinement] ?? r.refinement}
                  </Chip>
                ))}
              </span>
            </div>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-scrollable overflow region */}
            <div className="rd-scroll" tabIndex={0}>
              <table className="dtable rd-drops">
                <thead>
                  <tr>
                    <th>Drop</th>
                    <th className="r">Chance</th>
                    <th className="r">Plat</th>
                    <th className="r">Ducats</th>
                    <th className="r">You own</th>
                  </tr>
                </thead>
                <tbody>
                  {d.drops.map((drop) => {
                    const chance = chanceAt(drop.chances);
                    return (
                      <tr
                        key={drop.reward_name}
                        className={clsx((drop.wanted || drop.set) && "hot")}
                      >
                        <td>
                          <span className="cd-mark">{drop.set ? "◆" : drop.wanted ? "★" : ""}</span>
                          {drop.reward_slug ? (
                            <button
                              type="button"
                              className={clsx("crk-link", drop.rare && "rt-rare")}
                              onClick={() => onOpen(drop.reward_slug as string)}
                            >
                              {drop.reward_name}
                            </button>
                          ) : (
                            <span className={clsx("cd-nm", drop.rare && "rt-rare")}>
                              {drop.reward_name}
                            </span>
                          )}
                          {drop.rare ? (
                            <span className="rd-rare-tag" title="gold-tier (rare) reward">
                              RARE
                            </span>
                          ) : null}
                          {drop.set && drop.set_slug ? (
                            <button
                              type="button"
                              className="crk-setlink"
                              title="Completes a one-away set — go to it"
                              onClick={() =>
                                onNavigate("sets", { focusSetSlug: drop.set_slug as string })
                              }
                            >
                              → set
                            </button>
                          ) : null}
                        </td>
                        <td className="r num">{chance != null ? `${chance.toFixed(1)}%` : "—"}</td>
                        <td className="r num">{drop.plat != null ? `${fmt(drop.plat)}p` : "—"}</td>
                        <td className="r num ducat">
                          {drop.ducats != null ? fmt(drop.ducats) : "—"}
                        </td>
                        <td className={clsx("r num", drop.owned_qty === 0 && "muted")}>
                          {drop.owned_qty > 0 ? `×${drop.owned_qty}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Scrim>
  );
}

// One-decimal formatting for EV deltas (fmt rounds to integers).
function fmt1(v: number): string {
  return (Math.round(v * 10) / 10).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}
