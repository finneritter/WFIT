import { memo, useEffect, useMemo, useState } from "react";
import { useWorldstate } from "../hooks/queries";
import { clsx, countdown, fmt, glyph, msUntil, nextUtc } from "../lib/format";
import type {
  ArbitrationBlock,
  Fissure,
  Sortie,
  SteelPath,
  Trader,
  VendorItem,
  Worldstate,
} from "../lib/types";

const TABS = [
  ["overview", "Overview"],
  ["fissures", "Fissures"],
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

// One shared 1s interval drives every live countdown; leaves subscribe so only
// the timer cells re-render each second — not the whole fissure table + summary.
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | undefined;
function subscribeTick(fn: () => void): () => void {
  tickListeners.add(fn);
  if (tickTimer === undefined) {
    tickTimer = setInterval(() => {
      for (const l of tickListeners) l();
    }, 1000);
  }
  return () => {
    tickListeners.delete(fn);
    if (tickListeners.size === 0 && tickTimer !== undefined) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  };
}

/** A self-ticking countdown leaf — re-renders itself each second, in isolation.
 *  Recolors as it crosses thresholds: ink → --hot (warn) → --neg (soon).
 *  Hero/vendor timers pass larger (hours-scale) thresholds. */
const Countdown = memo(function Countdown({
  iso,
  fallback = "—",
  warnMs = 5 * 60_000,
  soonMs = 90_000,
}: {
  iso: string | null | undefined;
  fallback?: string;
  warnMs?: number;
  soonMs?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribeTick(() => setNow(Date.now())), []);
  if (!iso) return <>{fallback}</>;
  const ms = new Date(iso).getTime() - now;
  const cls = ms > 0 && ms <= soonMs ? "cd-soon" : ms > 0 && ms <= warnMs ? "cd-warn" : null;
  const text = countdown(iso, now);
  return cls ? <span className={cls}>{text}</span> : <>{text}</>;
});

const hhmm = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Community S–D arbitration rating (browse.wf / Arbitration Goons) as a grade box. */
function TierBadge({ tier }: { tier: string | null }) {
  return (
    <span className={clsx("tierb", tier && `t-${tier.toLowerCase()}`)} title="community rating">
      {tier ?? "—"}
    </span>
  );
}

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
  const counts: Array<[string, number]> = [
    ["Normal", ground.filter((f) => !f.is_hard).length],
    ["Steel Path", ground.filter((f) => f.is_hard).length],
    ["Void Storms", live.filter((f) => f.is_storm).length],
    ["Total live", live.length],
  ];
  return (
    <div className={clsx("fwx", hit && "hit")}>
      <div className="fwx-top">
        <span className="led" />
        <span className="lbl">Fissure Watch</span>
        <span>Void Cascade · Omnia</span>
        <span className="status">{hit ? "● ACTIVE NOW" : "○ NOT UP"}</span>
      </div>
      <div className="fwx-main">
        <div>
          <div className="fwx-title">{hit ? "Void Cascade" : "No Cascade Up"}</div>
          <div className="fwx-meta">
            {focus ? (
              <>
                <span>{focus.node}</span>
                <span className="muted">·</span>
                <span>{focus.mission_type}</span>
                {focus.is_hard ? <span className="badge sp">Steel Path</span> : null}
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
          <div className="tl">{hit ? "time remaining" : "omnia rotates"}</div>
        </div>
      </div>
      <div className="fwx-counts">
        {counts.map(([k, v]) => (
          <div className="fwx-cell" key={k}>
            <div className="v">{v}</div>
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
        <span className="meta">rotates hourly</span>
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
        <div className="empty">No data.</div>
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

function SteelPathPanel({ sp }: { sp: SteelPath | null }) {
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Steel Path · Teshin</h3>
        {sp?.expiry ? (
          <span className="meta num">
            <Countdown iso={sp.expiry} />
          </span>
        ) : null}
      </div>
      {!sp ? (
        <div className="empty">No data.</div>
      ) : (
        <>
          <div className="sp-now">
            <span className="sp-name">{sp.current_reward?.name ?? "—"}</span>
            {sp.current_reward?.cost != null ? (
              <span className="sp-cost num">{sp.current_reward.cost} essence</span>
            ) : null}
          </div>
          {sp.rotation.map((r) => (
            <div key={r.name} className={clsx("sp-r", r.name === sp.current_reward?.name && "on")}>
              <span>{r.name}</span>
              <span className="num">{r.cost ?? "—"}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Fixed UTC reset rules + the data-driven rotations, one countdown per row.
 *  Baro/Varzia live in the Void Traders panel, not here. */
function ResetsPanel({ ws }: { ws: Worldstate }) {
  const rows: Array<[string, string | null]> = [
    ["Daily reset", nextUtc(0)],
    ["Sortie", ws.sortie?.expiry ?? nextUtc(16)],
    ["Weekly reset", nextUtc(0, 1)],
    ["Archon hunt", ws.archon_hunt?.expiry ?? nextUtc(0, 1)],
    ["Teshin reward", ws.steel_path?.expiry ?? null],
  ];
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Resets</h3>
        <span className="meta">UTC schedule</span>
      </div>
      {rows.map(([label, iso]) => (
        <div className="reset-row" key={label}>
          <span>{label}</span>
          <b className="num">
            <Countdown iso={iso} />
          </b>
        </div>
      ))}
    </div>
  );
}

/** Compact trader status — full stock lives on the Vendors tab. */
function TradersPanel({ ws }: { ws: Worldstate }) {
  const rows: Array<{ name: string; trader: Trader | null; sub: string }> = [
    {
      name: "Baro Ki'Teer",
      trader: ws.baro,
      sub: ws.baro?.active ? (ws.baro.location ?? "here now") : "away",
    },
    {
      name: "Varzia",
      trader: ws.varzia,
      sub: "prime resurgence",
    },
  ];
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Void Traders</h3>
        <span className="meta">stock on Vendors tab</span>
      </div>
      {rows.map(({ name, trader, sub }) => (
        <div className="vend-row" key={name}>
          <span className={clsx("vdot", trader?.active && "on")} />
          <div className="vi">
            <div className="vn">{name}</div>
            <div className="vs">{sub}</div>
          </div>
          <b className="num">
            <Countdown
              iso={trader ? (trader.active ? trader.expiry : trader.activation) : null}
              warnMs={3_600_000}
              soonMs={15 * 60_000}
            />
          </b>
        </div>
      ))}
    </div>
  );
}

function OverviewTab({ ws }: { ws: Worldstate }) {
  return (
    <>
      <div className="cyclebar">
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
      <FissureWatchHero ws={ws} />
      <div className="rot-cols">
        <div className="rot-col">
          <ArbitrationPanel block={ws.arbitration} />
          <SortiePanel title="Sortie" data={ws.sortie} />
        </div>
        <div className="rot-col">
          <SortiePanel title="Archon Hunt" data={ws.archon_hunt} />
          <SteelPathPanel sp={ws.steel_path} />
        </div>
        <div className="rot-col">
          <ResetsPanel ws={ws} />
          <TradersPanel ws={ws} />
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
function VendorTable({ items, currency }: { items: VendorItem[]; currency: "ducats" | "aya" }) {
  const aya = currency === "aya";
  const costCls = aya ? "v-aya" : "v-ducat";
  const totalCost = items.reduce((s, it) => s + (it.ducats ?? 0), 0);
  const totalCred = items.reduce((s, it) => s + (it.credits ?? 0), 0);
  return (
    <div className={clsx("vt", aya && "aya")}>
      <div className="vt-head">
        <span />
        <span>Item</span>
        <span className="r">{aya ? "Aya" : "Ducats"}</span>
        <span className="r">Credits</span>
      </div>
      {items.map((it, i) => (
        <div className="vrow" key={`${it.item}-${i}`}>
          <span className="vgl">{glyph(it.item)}</span>
          <span className="vn">{it.item}</span>
          <span className={costCls}>{it.ducats ?? "—"}</span>
          <span className="v-cred">{it.credits != null ? fmt(it.credits) : "—"}</span>
        </div>
      ))}
      <div className="vt-foot">
        <span />
        <span className="tk">Total</span>
        <span className={costCls}>{fmt(totalCost)}</span>
        <span className="v-cred">{totalCred > 0 ? fmt(totalCred) : "—"}</span>
      </div>
    </div>
  );
}

function VendorsTab({ ws }: { ws: Worldstate }) {
  return (
    <>
      <BaroHero baro={ws.baro} />
      <div className="rot-grid vend">
        <div className="tpanel">
          <div className="tpanel-h">
            <h3>Baro · Stock</h3>
            {ws.baro && ws.baro.inventory.length > 0 ? (
              <span className="meta">{ws.baro.inventory.length} items</span>
            ) : null}
          </div>
          {ws.baro && ws.baro.inventory.length > 0 ? (
            <VendorTable items={ws.baro.inventory} currency="ducats" />
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
          {ws.varzia && ws.varzia.inventory.length > 0 ? (
            <VendorTable items={ws.varzia.inventory} currency="aya" />
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
            {fissures.length} active · as of{" "}
            {new Date(ws.fetched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
          <div className="empty" style={{ padding: "10px 12px" }}>
            No active fissures match this filter.
          </div>
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

export function Rotation() {
  const { data: ws, isLoading, isError } = useWorldstate();
  const [tab, setTab] = useState<TabId>("overview");

  if (isLoading) return <div className="empty">Loading world-state…</div>;
  if (isError || !ws)
    return (
      <div className="empty">
        Couldn't reach api.warframestat.us. The rest of WFIT works offline.
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

      {tab === "overview" && <OverviewTab ws={ws} />}
      {tab === "fissures" && <FissuresTab ws={ws} deVerified={deVerified} />}
      {tab === "vendors" && <VendorsTab ws={ws} />}
    </>
  );
}
