import { memo, useEffect, useMemo, useState } from "react";
import { useWorldstate } from "../hooks/queries";
import { clsx, countdown, fmt, msUntil, nextUtc } from "../lib/format";
import type {
  ArbitrationBlock,
  Fissure,
  Sortie,
  SteelPath,
  Trader,
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

/** A self-ticking countdown leaf — re-renders itself each second, in isolation. */
const Countdown = memo(function Countdown({
  iso,
  fallback = "—",
}: {
  iso: string | null | undefined;
  fallback?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribeTick(() => setNow(Date.now())), []);
  return <>{iso ? countdown(iso, now) : fallback}</>;
});

const hhmm = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Community S–D arbitration rating (browse.wf / Arbitration Goons). */
function TierBadge({ tier }: { tier: string | null }) {
  return (
    <span className={clsx("tierb", tier && `t-${tier.toLowerCase()}`)} title="community rating">
      {tier ?? "—"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Overview panels
// ---------------------------------------------------------------------------

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

/** Fixed UTC reset rules + the data-driven rotations, one countdown per row. */
function ResetsPanel({ ws }: { ws: Worldstate }) {
  const rows: Array<[string, string | null]> = [
    ["Daily reset", nextUtc(0)],
    ["Sortie", ws.sortie?.expiry ?? nextUtc(16)],
    ["Weekly reset", nextUtc(0, 1)],
    ["Archon hunt", ws.archon_hunt?.expiry ?? nextUtc(0, 1)],
    ["Teshin reward", ws.steel_path?.expiry ?? null],
    [
      ws.baro?.active ? "Baro leaves" : "Baro arrives",
      ws.baro ? (ws.baro.active ? ws.baro.expiry : ws.baro.activation) : null,
    ],
    ["Varzia rotation", ws.varzia?.expiry ?? null],
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

function OverviewTab({ ws }: { ws: Worldstate }) {
  return (
    <>
      <div className="cyclebar">
        {ws.cycles.map((c) => (
          <div className="cyc" key={c.id}>
            <div className="cyc-st">{c.state}</div>
            <div className="cyc-pl">{c.name}</div>
            <div className="cyc-end num">
              <Countdown iso={c.expiry} fallback={c.time_left ?? "—"} />
            </div>
          </div>
        ))}
      </div>
      <div className="rot-grid">
        <ArbitrationPanel block={ws.arbitration} />
        <SortiePanel title="Sortie" data={ws.sortie} />
        <SortiePanel title="Archon Hunt" data={ws.archon_hunt} />
        <SteelPathPanel sp={ws.steel_path} />
        <ResetsPanel ws={ws} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

function VendorPanel({
  title,
  trader,
  priceLabel,
  activeLabel,
  emptyNote,
}: {
  title: string;
  trader: Trader | null;
  priceLabel: string; // "Ducats" (Baro) or "Aya" (Varzia — wrapper reuses the key)
  activeLabel: string;
  emptyNote: string;
}) {
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>{title}</h3>
        {trader && trader.inventory.length > 0 ? (
          <span className="meta">{trader.inventory.length} items</span>
        ) : null}
      </div>
      {!trader ? (
        <div className="empty">No data right now.</div>
      ) : (
        <>
          <div className="baro">
            <div className="baro-cd">
              <span className="num">
                <Countdown iso={trader.active ? trader.expiry : trader.activation} />
              </span>
              <span className="bl">{trader.active ? activeLabel : "until arrival"}</span>
            </div>
            <div className="baro-meta">
              <b>{trader.location ?? "Unknown location"}</b>
              <div className="muted">{trader.active ? "here now" : "not yet arrived"}</div>
            </div>
          </div>
          {trader.inventory.length > 0 ? (
            <table className="dtable vtable">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="r">{priceLabel}</th>
                  <th className="r">Credits</th>
                </tr>
              </thead>
              <tbody>
                {trader.inventory.map((it, i) => (
                  <tr key={`${it.item}-${i}`}>
                    <td>{it.item}</td>
                    <td className="r num">{it.ducats ?? "—"}</td>
                    <td className="r num">{it.credits != null ? fmt(it.credits) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="baro-note">{emptyNote}</div>
          )}
        </>
      )}
    </div>
  );
}

function VendorsTab({ ws }: { ws: Worldstate }) {
  return (
    <div className="rot-grid v2">
      <VendorPanel
        title="Baro Ki'Teer"
        trader={ws.baro}
        priceLabel="Ducats"
        activeLabel="until departure"
        emptyNote="Baro's stock is only known once he arrives — the worldstate doesn't expose it before then, so the inventory appears here when he's active."
      />
      <VendorPanel
        title="Varzia · Prime Resurgence"
        trader={ws.varzia}
        priceLabel="Aya"
        activeLabel="rotation ends"
        emptyNote="No resurgence rotation listed right now."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fissures (the original Rotation content, unchanged behavior)
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
            className={clsx("ftype", s.tier === "Omnia" && "omnia", s.cascade && "cascade")}
            title={s.missions.length ? s.missions.join(" · ") : undefined}
          >
            <div className="ft-h">
              <span className="ft-name">{s.tier}</span>
              <span className="ft-n num">{s.count}</span>
            </div>
            <div className="ft-timer num">{s.count ? <Countdown iso={s.nextExpiry} /> : "—"}</div>
            {s.cascade ? (
              <div className="ft-missions">
                <b>⚡ Void Cascade</b>
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

  // warframestat occasionally serves a frozen snapshot; when its own timestamp
  // lags real time, whatever still depends on it reads as expired. Flag it so
  // that doesn't look like a WFIT bug. 15 min tolerates normal update lag.
  const sourceAgeMs = ws.source_timestamp ? -msUntil(ws.source_timestamp) : 0;
  const staleMins = Math.floor(sourceAgeMs / 60000);
  const sourceStale = staleMins >= 15;
  const staleFor = staleMins >= 120 ? `${Math.floor(staleMins / 60)}h` : `${staleMins}m`;

  return (
    <>
      {sourceStale ? (
        <div className="ws-stale">
          {deVerified ? (
            <>
              ⚠ api.warframestat.us is lagging ({staleFor} old), so the cycle bar, vendors and
              sortie info may be off. Fissures are unaffected — they're verified against DE's
              worldstate directly.
            </>
          ) : (
            <>
              ⚠ Both world-state sources are degraded — api.warframestat.us is {staleFor} old and
              DE's worldstate is unreachable, so fissures and cycles below may read as expired. This
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
