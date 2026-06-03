import { memo, useEffect, useMemo, useState } from "react";
import { useWorldstate } from "../hooks/queries";
import { clsx, countdown, msUntil } from "../lib/format";
import type { Fissure } from "../lib/types";

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

export function Rotation() {
  const { data: ws, isLoading, isError } = useWorldstate();
  const [tier, setTier] = useState<string>("All");

  // Filtered/sorted only when the data or filters change (not every second);
  // expired fissures fall off on the next worldstate refetch (~45s).
  const fissures = useMemo(() => {
    if (!ws) return [];
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
    const live = (ws?.fissures ?? []).filter((f) => msUntil(f.expiry) > 0 && !f.is_storm);
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

  if (isLoading) return <div className="empty">Loading world-state…</div>;
  if (isError || !ws)
    return (
      <div className="empty">
        Couldn't reach api.warframestat.us. The rest of WFIT works offline.
      </div>
    );

  // Fissures normally come from DE's raw worldstate (authoritative, ≤~43s old);
  // warframestat only feeds the cycle bar + Baro, and is the fissure fallback.
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
              ⚠ api.warframestat.us is lagging ({staleFor} old), so the cycle bar and Baro may be
              off. Fissures are unaffected — they're verified against DE's worldstate directly.
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

      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Baro Ki'Teer</h3>
        </div>
        {ws.baro ? (
          <>
            <div className="baro">
              <div className="baro-cd">
                <span className="num">
                  <Countdown iso={ws.baro.active ? ws.baro.expiry : ws.baro.activation} />
                </span>
                <span className="bl">{ws.baro.active ? "until departure" : "until arrival"}</span>
              </div>
              <div className="baro-meta">
                <b>{ws.baro.location ?? "Unknown relay"}</b>
                <div className="muted">{ws.baro.active ? "here now" : "not yet arrived"}</div>
              </div>
            </div>
            <div className="baro-note">
              Baro's stock is only known once he arrives — warframe.market doesn't expose it before
              then, so there's no inventory list here until he's active.
            </div>
          </>
        ) : (
          <div className="empty">No Baro data right now.</div>
        )}
      </div>
    </>
  );
}
