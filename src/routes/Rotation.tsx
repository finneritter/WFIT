import { useMemo, useState } from "react";
import { Countdown, TierBadge } from "../components/Countdown";
import { BlockStatus, rowAction } from "../components/ui";
import { useCrackNow, useVendorIntel, useWantedNow, useWorldstate } from "../hooks/queries";
import { clsx, dayTime, fmt, glyph, hhmm, msUntil, nextUtc, tzLabel } from "../lib/format";
import type {
  ArbitrationBlock,
  CrackNowRow,
  Fissure,
  Invasion,
  Nightwave,
  Sortie,
  Trader,
  VendorIntelRow,
  Worldstate,
} from "../lib/types";

const TABS = [
  ["overview", "Overview"],
  ["fissures", "Fissures"],
  ["crack", "Crack"],
  ["vendors", "Vendors"],
] as const;
type TabId = (typeof TABS)[number][0];

const TIERS = ["All", "Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"] as const;
// Order for the per-type refresh strip. Omnia last + highlighted: it's the
// rotating Zariman type, the only place to crack relics in Void Cascade.
const FISSURE_TIERS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"] as const;

// World-cycle state → the 3px left-edge stripe color on cycle cards.
const CYCLE_CC: Record<string, string> = {
  day: "var(--c-day)",
  night: "var(--c-night)",
  warm: "var(--c-warm)",
  cold: "var(--c-cold)",
  fass: "var(--c-fass)",
  vome: "var(--c-vome)",
  joy: "var(--c-joy)",
  anger: "var(--c-anger)",
  envy: "var(--c-envy)",
  sorrow: "var(--c-sorrow)",
  fear: "var(--c-fear)",
};

// ---------------------------------------------------------------------------
// Overview: fissure-watch hero + panel columns
// ---------------------------------------------------------------------------

/** The screen's one most-important answer: is Void Cascade up?
 *  Green "hit" tint when it is; otherwise counts down the Omnia rotation. */
function FissureWatchHero({ ws }: { ws: Worldstate }) {
  const live = ws.fissures.filter((f) => msUntil(f.expiry) > 0);
  const ground = live.filter((f) => !f.is_storm);
  // If both Normal + Steel Path cascades are up, show the longer-lived one.
  const cascade = ground
    .filter((f) => /cascade/i.test(f.mission_type))
    .sort((a, b) => msUntil(b.expiry) - msUntil(a.expiry))[0];
  const omnia = ground
    .filter((f) => f.tier.toLowerCase() === "omnia")
    .sort((a, b) => msUntil(a.expiry) - msUntil(b.expiry))[0];
  const hit = cascade !== undefined;
  const focus = cascade ?? omnia;
  const spOmnia = ground.filter((f) => f.is_hard && f.tier.toLowerCase() === "omnia").length;
  const counts: Array<[string, number, boolean?]> = [
    ["Normal", ground.filter((f) => !f.is_hard).length],
    ["Steel Path", ground.filter((f) => f.is_hard).length],
    ["SP Omnia", spOmnia, spOmnia > 0],
    ["Void Storms", live.filter((f) => f.is_storm).length],
  ];
  return (
    <div className={clsx("fwx", hit && "hit")}>
      <div className="fwx-top">
        <span className="led" />
        <span className="lbl">Fissure Watch</span>
        <span>
          {focus ? `${focus.is_hard ? "Steel Path" : "Normal"} · ${focus.tier}` : "Omnia"}
        </span>
        <span className="status">{hit ? "● ACTIVE NOW" : "○ NOT UP"}</span>
      </div>
      <div className="fwx-main">
        <div>
          <div className="fwx-title">{hit ? "Void Cascade" : "No Cascade Up"}</div>
          <div className="fwx-meta">
            {focus ? (
              <>
                <span className={clsx("ftier", `t-${focus.tier.toLowerCase()}`)}>{focus.tier}</span>
                {focus.is_hard ? <span className="badge sp">Steel Path</span> : null}
                <span className="muted">·</span>
                <span>{focus.node}</span>
              </>
            ) : (
              <span className="muted">no omnia fissure live</span>
            )}
          </div>
        </div>
        <div className="fwx-timer">
          <div className="big">
            <Countdown iso={focus?.expiry} warnMs={15 * 60_000} soonMs={5 * 60_000} />
          </div>
          <div className="tl">{hit ? "remaining" : "omnia rotates"}</div>
        </div>
      </div>
      <div className="fwx-counts">
        {counts.map(([k, v, hot]) => (
          <div className="fwx-cell" key={k}>
            <div className={clsx("v", hot && "pos")}>{v}</div>
            <div className="k">{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArbitrationPanel({ block }: { block: ArbitrationBlock | null }) {
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Arbitration</h3>
        <span className="meta">rotates hourly · {tzLabel()}</span>
      </div>
      {!block ? (
        <div className="empty">Schedule unavailable (browse.wf unreachable).</div>
      ) : (
        <>
          {block.current ? (
            <div className="arb-now">
              <TierBadge tier={block.current.tier} />
              <div className="arb-i">
                <div className="arb-mission">{block.current.mission_type}</div>
                <div className="arb-node">
                  {block.current.node}
                  {block.current.enemy ? ` · ${block.current.enemy}` : ""}
                </div>
              </div>
              <div className="arb-cd num">
                <Countdown iso={block.current.expiry} />
              </div>
            </div>
          ) : (
            <div className="empty">No live arbitration right now.</div>
          )}
          {block.upcoming.map((a) => (
            <div className="arb-row" key={a.activation}>
              <span className="arb-at num">{hhmm(a.activation)}</span>
              <TierBadge tier={a.tier} />
              <span className="arb-rn">{a.node}</span>
              <span className="arb-rm">{a.mission_type}</span>
            </div>
          ))}
          {block.notable.length > 0 ? (
            <>
              <div className="fgroup-h">Ones of note · S/A</div>
              {block.notable.map((a) => (
                <div className="arbn-row" key={`n-${a.activation}`}>
                  <TierBadge tier={a.tier} />
                  <div className="arbn-i">
                    <div className="arbn-n">{a.node}</div>
                    <div className="arbn-s">
                      {a.mission_type}
                      {a.enemy ? ` · ${a.enemy}` : ""}
                    </div>
                  </div>
                  <div className="arbn-r">
                    <div className="arbn-at num">{dayTime(a.activation)}</div>
                    <div className="arbn-cd num">
                      <Countdown iso={a.activation} />
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : null}
          <div className="src-note">schedule + tiers via browse.wf · Arbitration Goons</div>
        </>
      )}
    </div>
  );
}

/** Daily sortie and weekly archon hunt share one shape (the hunt has no modifiers). */
function SortiePanel({ title, data }: { title: string; data: Sortie | null }) {
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>{title}</h3>
        {data?.expiry ? (
          <span className="meta num">
            <Countdown iso={data.expiry} />
          </span>
        ) : null}
      </div>
      {!data ? (
        <div className="empty">No data from either source right now.</div>
      ) : (
        <>
          <div className="srt-boss">
            <b>{data.boss}</b>
            {data.faction ? <span className="muted"> · {data.faction}</span> : null}
          </div>
          {data.missions.map((m, i) => (
            <div className="srt-row" key={`${m.node}-${i}`} title={m.modifier_desc ?? undefined}>
              <div className="srt-top">
                <span className="srt-t">{m.mission_type}</span>
                <span className="srt-node">{m.node}</span>
              </div>
              {m.modifier ? <span className="srt-mod">{m.modifier}</span> : null}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Active Nightwave challenges, biggest standing first. Player rank/standing
 *  is account data the worldstate doesn't carry, so it isn't shown. */
function NightwavePanel({ nw }: { nw: Nightwave | null }) {
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Nightwave</h3>
        {nw?.expiry ? (
          <span className="meta num">
            season ends <Countdown iso={nw.expiry} />
          </span>
        ) : null}
      </div>
      {!nw ? (
        <div className="empty">
          No season data — api.warframestat.us is unreachable. Fills in automatically when it
          recovers (DE's feed doesn't carry Nightwave).
        </div>
      ) : (
        nw.challenges.map((c) => (
          <div className="nw-row" key={c.title} title={c.desc ?? undefined}>
            <span className={clsx("tag", !c.is_daily && "weekly")}>
              {c.is_daily ? "daily" : c.is_elite ? "elite" : "weekly"}
            </span>
            <span className="nw-t">{c.title}</span>
            <b className="num">{fmt(c.reputation)}</b>
          </div>
        ))
      )}
    </div>
  );
}

/** Live invasions: both sides' rewards, node · factions, attacker progress. */
function InvasionsPanel({ invasions }: { invasions: Invasion[] }) {
  const shown = invasions.slice(0, 6);
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Invasions</h3>
        <span className="meta">{invasions.length} active</span>
      </div>
      {shown.length === 0 ? (
        <div className="empty">No active invasions.</div>
      ) : (
        shown.map((i) => (
          <div className="inv-row" key={`${i.node}-${i.attacker_reward}-${i.defender_reward}`}>
            <div className="inv-i">
              <div className="inv-r">
                {[i.attacker_reward, i.defender_reward].filter(Boolean).join(" · ") || "—"}
              </div>
              <div className="inv-s">
                {i.node} · {i.attacker} vs {i.defender}
              </div>
            </div>
            <b className="num">{Math.round(i.completion)}%</b>
          </div>
        ))
      )}
    </div>
  );
}

// Wanted items (watchlist + missing set parts) farmable from a live reward source
// right now. Hidden entirely when nothing you want is currently available.
function WantedNowPanel({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: rows = [] } = useWantedNow();
  if (rows.length === 0) return null;
  return (
    <div className="tpanel wn-panel">
      <div className="tpanel-h">
        <h3>Wanted now</h3>
        <span className="meta">{rows.length} farmable</span>
      </div>
      <div className="wn-list">
        {rows.map((r, i) => (
          <div
            className="wn-row click"
            key={`${r.slug}-${r.source_label}-${i}`}
            {...rowAction(() => onOpen(r.slug))}
          >
            <span className="vgl">{glyph(r.display_name)}</span>
            <span className="wn-nm">{r.display_name}</span>
            <span className="wn-src">{r.source_label}</span>
            <span className="wn-eta num">{r.eta ? <Countdown iso={r.eta} /> : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One crack-list row: glyph · name ×qty + the wanted drops it can yield ·
 *  refinement · drop-EV. Used by both groups in the Crack tab. */
function CrackRow({ r }: { r: CrackNowRow }) {
  return (
    <div className="wn-row" key={`${r.tier}-${r.relic_name}-${r.refinement}`}>
      <span className="vgl">{glyph(r.display_name)}</span>
      <span className="wn-nm">
        {r.display_name} <span className="muted">×{r.qty}</span>
        {r.wanted_drops.length > 0 ? (
          <span className="wn-want"> wants: {r.wanted_drops.join(", ")}</span>
        ) : null}
      </span>
      <span className="wn-src">{r.refinement}</span>
      <span className="wn-eta num">~{fmt(Math.round(r.ev_plat))}p</span>
    </div>
  );
}

// Owned relics whose drops include something you want — a watch/buy-list item or the
// missing part of a set you're 1–2 parts from completing. Split into the relics a
// live fissure can crack right now and the rest (kept for planning).
function CrackTab() {
  const { data: rows = [], isLoading } = useCrackNow();
  const now = rows.filter((r) => r.crackable_now);
  const later = rows.filter((r) => !r.crackable_now);
  return (
    <div className="tpanel wn-panel">
      <div className="tpanel-h">
        <h3>Crack</h3>
        <span className="meta">
          {rows.length} owned relic{rows.length === 1 ? "" : "s"} can drop something you want
        </span>
      </div>
      {isLoading ? (
        <BlockStatus text="Loading relics…" />
      ) : rows.length === 0 ? (
        <BlockStatus text="None of your relics drop a wanted item yet. Add items to your watch or buy list, or get closer (within 2 parts) to completing a set, and matching relics show up here." />
      ) : (
        <>
          {now.length > 0 ? (
            <>
              <div className="fgroup-h">Crackable now · {now.length}</div>
              <div className="wn-list">
                {now.map((r) => (
                  <CrackRow r={r} key={`${r.tier}-${r.relic_name}-${r.refinement}`} />
                ))}
              </div>
            </>
          ) : null}
          {later.length > 0 ? (
            <>
              <div className="fgroup-h">Waiting on a fissure · {later.length}</div>
              <div className="wn-list">
                {later.map((r) => (
                  <CrackRow r={r} key={`${r.tier}-${r.relic_name}-${r.refinement}`} />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function OverviewTab({ ws, onOpen }: { ws: Worldstate; onOpen: (slug: string) => void }) {
  // The right-side reset strip: fixed UTC game resets + the data-driven ends.
  const resets: Array<[string, string | null]> = [
    ["Daily reset", nextUtc(0)],
    ["Sortie", ws.sortie?.expiry ?? nextUtc(16)],
    ["Nightwave", ws.nightwave?.expiry ?? null],
    ["Weekly reset", nextUtc(0, 1)],
  ];
  return (
    <>
      <div className="rot-top">
        <FissureWatchHero ws={ws} />
        <div className="cycgrid">
          {ws.cycles.map((c) => (
            <div
              className="cyc"
              key={c.id}
              style={{ "--cc": CYCLE_CC[c.state.toLowerCase()] } as React.CSSProperties}
            >
              <div className="cyc-st">{c.state}</div>
              <div className="cyc-pl">{c.name}</div>
              <div className="cyc-end num">
                <Countdown iso={c.expiry} fallback={c.time_left ?? "—"} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rsetbar">
        {resets.map(([label, iso]) => (
          <div className="rsetbox" key={label}>
            <div className="k">{label}</div>
            <div className="v">
              <Countdown iso={iso} />
            </div>
          </div>
        ))}
      </div>
      <WantedNowPanel onOpen={onOpen} />
      <div className="rot-grid v2">
        <div className="rot-col">
          <ArbitrationPanel block={ws.arbitration} />
          <NightwavePanel nw={ws.nightwave} />
        </div>
        <div className="rot-col">
          <SortiePanel title="Sortie" data={ws.sortie} />
          <SortiePanel title="Archon Hunt" data={ws.archon_hunt} />
          <InvasionsPanel invasions={ws.invasions} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Vendors: Baro-arrival hero + currency-colored stock tables
// ---------------------------------------------------------------------------

/** §7.12 hero — the Vendors screen's one answer: is Baro here, and for how long? */
function BaroHero({ baro }: { baro: Trader | null }) {
  const active = baro?.active ?? false;
  return (
    <div className={clsx("fwx", active && "hit")}>
      <div className="fwx-top">
        <span className="led" />
        <span className="lbl">Void Trader</span>
        <span>bi-weekly relay visit</span>
        <span className="status">{active ? "● HERE NOW" : "away"}</span>
      </div>
      <div className="fwx-main">
        <div>
          <div className="fwx-title">Baro Ki'Teer</div>
          <div className="fwx-meta">
            <span>{baro?.location ?? "location unknown"}</span>
            <span className="muted">·</span>
            <span className="muted">
              {active
                ? `${baro?.inventory.length ?? 0} items in stock`
                : "stock revealed on arrival"}
            </span>
          </div>
        </div>
        <div className="fwx-timer">
          <div className="big">
            <Countdown
              iso={baro ? (active ? baro.expiry : baro.activation) : null}
              warnMs={12 * 3_600_000}
              soonMs={2 * 3_600_000}
            />
          </div>
          <div className="tl">{active ? "until departure" : "until arrival"}</div>
        </div>
      </div>
    </div>
  );
}

/** §7.13 stock table — glyph tile · name · currency (colored) · credits. */
function VendorTable({
  rows,
  currency,
  onOpen,
}: {
  rows: VendorIntelRow[];
  currency: "ducats" | "aya";
  onOpen: (slug: string) => void;
}) {
  const aya = currency === "aya";
  const costCls = aya ? "v-aya" : "v-ducat";
  const totalCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
  const totalValue = rows.reduce((s, r) => s + (r.median_plat ?? 0), 0);
  return (
    <div className={clsx("vt", aya && "aya")}>
      <div className="vt-head">
        <span />
        <span>Item</span>
        <span className="r">Value</span>
        <span className="r">{aya ? "Aya" : "Ducats"}</span>
      </div>
      {rows.map((r, i) => {
        const clickable = r.slug != null;
        return (
          <div
            className={clsx("vrow", r.good_deal && "deal", clickable && "click")}
            key={`${r.item}-${i}`}
            title={
              r.cost_per_plat != null
                ? `${r.cost_per_plat.toFixed(1)} ${aya ? "aya" : "ducats"} per plat of value`
                : undefined
            }
            {...(clickable ? rowAction(() => onOpen(r.slug as string)) : {})}
          >
            <span className="vgl">
              {r.thumbnail_url ? (
                <img src={r.thumbnail_url} alt="" loading="lazy" />
              ) : (
                glyph(r.item)
              )}
            </span>
            <span className="vn" title={r.item}>
              {r.item}
              {r.good_deal ? <span className="deal-tag">DEAL</span> : null}
              {r.owned_qty > 0 ? <span className="owned-tag">OWNED ×{r.owned_qty}</span> : null}
            </span>
            <span className="v-plat">{r.median_plat != null ? `${fmt(r.median_plat)}p` : "—"}</span>
            <span className={costCls}>{fmt(r.cost)}</span>
          </div>
        );
      })}
      <div className="vt-foot">
        <span />
        <span className="tk">Total</span>
        <span className="v-plat">{totalValue > 0 ? `${fmt(totalValue)}p` : "—"}</span>
        <span className={costCls}>{fmt(totalCost)}</span>
      </div>
    </div>
  );
}

function VendorsTab({ ws, onOpen }: { ws: Worldstate; onOpen: (slug: string) => void }) {
  // Enriched stock (market value + ownership). The intel command reads the same
  // cached worldstate, so its rows mirror ws.baro/ws.varzia 1:1 (same order).
  const { data: intel } = useVendorIntel();
  const baroRows = intel?.baro ?? [];
  const varziaRows = intel?.varzia ?? [];
  return (
    <>
      <BaroHero baro={ws.baro} />
      <div className="rot-grid vend">
        <div className="tpanel">
          <div className="tpanel-h">
            <h3>Baro · Stock</h3>
            {baroRows.length > 0 ? <span className="meta">{baroRows.length} items</span> : null}
          </div>
          {baroRows.length > 0 ? (
            <VendorTable rows={baroRows} currency="ducats" onOpen={onOpen} />
          ) : (
            <div className="baro-note">
              Baro's stock is only known once he arrives — the worldstate doesn't expose it before
              then, so the inventory appears here when he's active.
            </div>
          )}
        </div>
        <div className="tpanel">
          <div className="tpanel-h">
            <h3>Varzia · Prime Resurgence</h3>
            {ws.varzia?.expiry ? (
              <span className="meta num">
                <Countdown iso={ws.varzia.expiry} /> left
              </span>
            ) : null}
          </div>
          {varziaRows.length > 0 ? (
            <VendorTable rows={varziaRows} currency="aya" onOpen={onOpen} />
          ) : (
            <div className="baro-note">No resurgence rotation listed right now.</div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fissures (the original Rotation content, restyled behavior-intact)
// ---------------------------------------------------------------------------

/** One fissure group's table (tier · mission · location · live time-left).
 *  `ftable` pins the column widths — the groups are separate <table>s, so
 *  without it each one auto-sizes and the columns drift out of line. */
function FissureTable({ rows }: { rows: Fissure[] }) {
  return (
    <table className="dtable ftable">
      <thead>
        <tr>
          <th>Tier</th>
          <th>Mission</th>
          <th>Location</th>
          <th className="r">Time left</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f, i) => (
          <tr key={`${f.node}-${i}`}>
            <td>
              <span className={clsx("ftier", `t-${f.tier.toLowerCase()}`)}>{f.tier}</span>
            </td>
            <td>{f.mission_type}</td>
            <td>{f.node}</td>
            <td className="r when num">
              <Countdown iso={f.expiry} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FissuresTab({ ws, deVerified }: { ws: Worldstate; deVerified: boolean }) {
  const [tier, setTier] = useState<string>("All");

  // Filtered/sorted only when the data or filters change (not every second);
  // expired fissures fall off on the next worldstate refetch (~45s).
  const fissures = useMemo(() => {
    return ws.fissures
      .filter(
        (f) =>
          msUntil(f.expiry) > 0 && // drop expired
          (tier === "All" || f.tier.toLowerCase() === tier.toLowerCase()),
      )
      .sort((a, b) => msUntil(a.expiry) - msUntil(b.expiry));
  }, [ws, tier]);

  // The three in-game fissure modes live in different menus, so split them:
  // Normal relic fissures, Steel Path (isHard), and Railjack "Void Storms" (isStorm).
  const groups = useMemo(
    () => ({
      normal: fissures.filter((f) => !f.is_hard && !f.is_storm),
      steel: fissures.filter((f) => f.is_hard && !f.is_storm),
      storm: fissures.filter((f) => f.is_storm),
    }),
    [fissures],
  );

  // Per-tier refresh summary: count + next rotation. The Omnia card surfaces the
  // current Zariman/Lua mission and flags Void Cascade when it's up — the same
  // fissure also appears as a row in the grouped list below (in its Normal/Steel
  // Path group). Excludes Railjack storms.
  const typeSummary = useMemo(() => {
    const live = ws.fissures.filter((f) => msUntil(f.expiry) > 0 && !f.is_storm);
    return FISSURE_TIERS.map((t) => {
      const of = live
        .filter((f) => f.tier.toLowerCase() === t.toLowerCase())
        .sort((a, b) => msUntil(a.expiry) - msUntil(b.expiry));
      const missions = [...new Set(of.map((f) => f.mission_type))];
      const cascade = of.find((f) => /cascade/i.test(f.mission_type));
      return {
        tier: t,
        count: of.length,
        nextExpiry: of[0]?.expiry ?? null,
        missions,
        cascade: cascade
          ? { steel: cascade.is_hard, node: cascade.node, expiry: cascade.expiry }
          : null,
      };
    });
  }, [ws]);

  return (
    <>
      <div className="ftypes">
        {typeSummary.map((s) => (
          <div
            key={s.tier}
            className={clsx("ftype", `t-${s.tier.toLowerCase()}`, s.cascade && "cascade")}
            title={s.missions.length ? s.missions.join(" · ") : undefined}
          >
            <div className="ft-h">
              <span className="ft-name">{s.tier}</span>
              <span className="ft-n num">{s.count}</span>
            </div>
            <div className="ft-timer num">{s.count ? <Countdown iso={s.nextExpiry} /> : "—"}</div>
            {s.cascade ? (
              <div className="ft-missions">
                <b>Void Cascade</b>
                <span className="ft-grp">{s.cascade.steel ? "Steel Path" : "Normal"}</span>
              </div>
            ) : (
              <div className="ft-sub">{s.count ? "next refresh" : "none up"}</div>
            )}
          </div>
        ))}
      </div>

      <div className="tpanel" style={{ marginBottom: 12 }}>
        <div className="tpanel-h">
          <h3>Void Fissures</h3>
          <span className="meta">
            {fissures.length} active · as of {hhmm(ws.fetched_at)}
            {deVerified ? " · DE-verified" : " · unverified (DE unreachable)"}
          </span>
        </div>
        <div className="filters" style={{ padding: "8px 12px", marginBottom: 0 }}>
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              aria-pressed={tier === t}
              onClick={() => setTier(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {fissures.length === 0 ? (
          <BlockStatus text="No active fissures match this filter." />
        ) : (
          <>
            {groups.normal.length > 0 ? (
              <>
                <div className="fgroup-h">Normal · {groups.normal.length}</div>
                <FissureTable rows={groups.normal} />
              </>
            ) : null}
            {groups.steel.length > 0 ? (
              <>
                <div className="fgroup-h">Steel Path · {groups.steel.length}</div>
                <FissureTable rows={groups.steel} />
              </>
            ) : null}
            {groups.storm.length > 0 ? (
              <>
                <div className="fgroup-h">Void Storms · Railjack · {groups.storm.length}</div>
                <FissureTable rows={groups.storm} />
              </>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function Rotation({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: ws, isLoading, isError, isFetching, refetch } = useWorldstate();
  const [tab, setTab] = useState<TabId>("overview");

  if (isLoading) return <div className="empty">Loading world-state…</div>;
  if (isError || !ws)
    return (
      <div className="empty">
        Couldn't reach api.warframestat.us. The rest of WFIT works offline.
        <div style={{ marginTop: 10 }}>
          <button type="button" className="chip" disabled={isFetching} onClick={() => refetch()}>
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      </div>
    );

  // Fissures normally come from DE's raw worldstate (authoritative, ≤~43s old);
  // warframestat only feeds the cycle bar + extras, and is the fissure fallback.
  const deVerified = ws.fissure_source === "de";

  // warframestat occasionally serves a frozen snapshot — but it now only feeds
  // the slow-moving extras (sortie/vendors/steel path); fissures AND cycles are
  // derived from DE directly. So an old snapshot is only worth a warning once
  // its own daily content has lapsed (sortie expired ⇒ the rest is suspect),
  // or when DE is also unreachable and everything leans on it.
  const sourceAgeMs = ws.source_timestamp ? -msUntil(ws.source_timestamp) : 0;
  const staleMins = Math.floor(sourceAgeMs / 60000);
  const sortieExpired = ws.sortie?.expiry != null && msUntil(ws.sortie.expiry) <= 0;
  const sourceStale = staleMins >= 15 && (!deVerified || sortieExpired);
  const staleFor = staleMins >= 120 ? `${Math.floor(staleMins / 60)}h` : `${staleMins}m`;

  return (
    <>
      {sourceStale ? (
        <div className="ws-stale">
          {deVerified ? (
            <>
              api.warframestat.us is lagging ({staleFor} old) and its daily content has expired —
              sortie and vendor info may be off until it recovers. Fissures and world cycles are
              unaffected: they're computed from DE's worldstate directly.
            </>
          ) : (
            <>
              Both world-state sources are degraded — api.warframestat.us is {staleFor} old and DE's
              worldstate is unreachable, so fissures and cycles below may read as expired. This
              clears itself once a source recovers; WFIT is fine.
            </>
          )}
        </div>
      ) : null}

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

      {tab === "overview" && <OverviewTab ws={ws} onOpen={onOpen} />}
      {tab === "fissures" && <FissuresTab ws={ws} deVerified={deVerified} />}
      {tab === "crack" && <CrackTab />}
      {tab === "vendors" && <VendorsTab ws={ws} onOpen={onOpen} />}
    </>
  );
}
