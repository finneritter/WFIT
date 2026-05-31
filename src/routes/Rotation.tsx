import { useEffect, useMemo, useState } from "react";
import { useWorldstate } from "../hooks/queries";
import { clsx, countdown, msUntil } from "../lib/format";

const TIERS = ["All", "Lith", "Meso", "Neo", "Axi", "Requiem"] as const;

/** Re-render every `ms` so countdowns tick live. */
function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function Rotation() {
  const { data: ws, isLoading, isError } = useWorldstate();
  const now = useNow();
  const [tier, setTier] = useState<string>("All");
  const [steelPath, setSteelPath] = useState(false);

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
    // re-derived each tick so expired fissures fall off live
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, tier, steelPath, now]);

  if (isLoading) return <div className="empty">Loading world-state…</div>;
  if (isError || !ws)
    return (
      <div className="empty">Couldn't reach api.warframestat.us. The rest of WFIT works offline.</div>
    );

  return (
    <>
      <div className="cyclebar">
        {ws.cycles.map((c) => (
          <div className="cyc" key={c.id}>
            <div className="cyc-st">{c.state}</div>
            <div className="cyc-pl">{c.name}</div>
            <div className="cyc-end num">{c.expiry ? countdown(c.expiry, now) : (c.time_left ?? "—")}</div>
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
                  <td className="r when num">{countdown(f.expiry, now)}</td>
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
                  {ws.baro.active
                    ? countdown(ws.baro.expiry, now)
                    : countdown(ws.baro.activation, now)}
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
