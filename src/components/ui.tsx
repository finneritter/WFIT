// Small shared presentational primitives used across screens.
import { clsx, glyph, tier } from "../lib/format";

/** The tier-edged item chip: the real warframe.market icon when available,
 *  falling back to a 2-letter monogram. */
export function Glyph({
  name,
  plat,
  thumb,
}: {
  name: string;
  plat: number | null | undefined;
  thumb?: string | null;
}) {
  return (
    <span className={clsx("gl", `t-${tier(plat)}`, thumb && "gl-img")}>
      {thumb ? <img src={thumb} alt="" loading="lazy" /> : glyph(name)}
    </span>
  );
}

export function StatBox({
  k,
  v,
  unit,
  d,
  dcls,
}: {
  k: string;
  v: React.ReactNode;
  unit?: string;
  d?: React.ReactNode;
  dcls?: string;
}) {
  return (
    <div className="statbox">
      <div className="k">{k}</div>
      <div className="v num">
        {v}
        {unit ? <span className="u"> {unit}</span> : null}
      </div>
      {d != null ? <div className={clsx("d", dcls)}>{d}</div> : null}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  count,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button type="button" className="chip" aria-pressed={!!active} onClick={onClick}>
      {children}
      {count != null ? <span className="n">{count}</span> : null}
    </button>
  );
}
