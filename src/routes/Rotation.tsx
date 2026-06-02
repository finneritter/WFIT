import { memo, useEffect, useMemo, useState } from "react";
import { useWorldstate } from "../hooks/queries";
import { clsx, countdown, msUntil } from "../lib/format";

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

export function Rotation() {
  const { data: ws, isLoading, isError } = useWorldstate();
  const [tier, setTier] = useState<string>("All");
  const [steelPath, setSteelPath] = useState(false);

  // Filtered/sorted only when the data or filters change (not every second);
  // expired fissures fall off on the next worldstate refetch (~45s).
  const fissures = useMemo(() => {
    if (!ws) return [];
    return ws.fissures
      .filter(
        (f) =>
          msUntil(f.expiry) > 0 && // drop expired
          (tier === "All" || f.tier.toLowerCase() === tier.toLowerCase()) &&
          (!steelPath || f.is_hard),
      )
      .sort((a, b) => msUntil(a.expiry) - msUntil(b.expiry));
  }, [ws, tier, steelPath]);

  // Per-tier refresh summary: how soon each fissure type next rotates, plus the
  // mission types currently up (the point of Omnia).
  const typeSummary = useMemo(() => {
    const live = (ws?.fissures ?? []).filter((f) => msUntil(f.expiry) > 0);
    return FISSURE_TIERS.map((t) => {
      const of = live
        .filter((f) => f.tier.toLowerCase() === t.toLowerCase())
        .sort((a, b) => msUntil(a.expiry) - msUntil(b.expiry));
      const missions = [...new Set(of.map((f) => f.mission_type))];
      return {
        tier: t,
        count: of.length,
        nextExpiry: of[0]?.expiry ?? null,
        missions,
        cascade: of.some((f) => /cascade/i.test(f.mission_type)),
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

  // The source occasionally serves a frozen snapshot; when its own timestamp lags
  // real time, every fissure/cycle reads as expired. Flag it so the empty page
  // doesn't look like a WFIT bug. 15 min tolerates normal update lag.
  const sourceAgeMs = ws.source_timestamp ? -msUntil(ws.source_timestamp) : 0;
  const staleMins = Math.floor(sourceAgeMs / 60000);
  const sourceStale = staleMins >= 15;

  return (
    <>
      {sourceStale ? (
        <div className="ws-stale">
          ⚠ warframe.market's world-state source (api.warframestat.us) is lagging — its data is{" "}
          {staleMins >= 120 ? `${Math.floor(staleMins / 60)}h` : `${staleMins}m`} old, so fissures
          and cycles below may read as expired. This clears itself once the source catches up; WFIT
          is fine.
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
            title={s.missions.join(" · ")}
          >
            <div className="ft-h">
              <span className="ft-name">{s.tier}</span>
              <span className="ft-n num">{s.count}</span>
            </div>
            <div className="ft-timer num">{s.count ? <Countdown iso={s.nextExpiry} /> : "—"}</div>
            {s.tier === "Omnia" && s.count ? (
              <div className="ft-missions">
                {s.cascade ? <b>⚡ Void Cascade</b> : (s.missions[0] ?? "—")}
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
          <span className="meta">{fissures.length} active</span>
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
          <span className="sp" />
          <button
            type="button"
            className="chip"
            aria-pressed={steelPath}
            onClick={() => setSteelPath((s) => !s)}
          >
            Steel Path
          </button>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Mission</th>
              <th>Location</th>
              <th>SP</th>
              <th className="r">Time left</th>
            </tr>
          </thead>
          <tbody>
            {fissures.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No active fissures match this filter.
                </td>
              </tr>
            ) : (
              fissures.map((f, i) => (
                <tr key={`${f.node}-${i}`}>
                  <td>
                    <span className={clsx("ftier", `t-${f.tier.toLowerCase()}`)}>
                      {f.tier}
                      {f.is_storm ? " ⛆" : ""}
                    </span>
                  </td>
                  <td>{f.mission_type}</td>
                  <td>{f.node}</td>
                  <td>{f.is_hard ? <span className="badge sp">SP</span> : ""}</td>
                  <td className="r when num">
                    <Countdown iso={f.expiry} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
