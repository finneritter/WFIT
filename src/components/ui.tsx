// Small shared presentational primitives used across screens.
import { memo } from "react";
import { clsx, glyph, tier } from "../lib/format";

/** The tier-edged item chip: the real warframe.market icon when available,
 *  falling back to a 2-letter monogram. */
export const Glyph = memo(function Glyph({
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
});

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

/** One full-width <tbody> status row: loading / error / empty. Mirrors the
 *  Market.tsx convention so every table screen reads the same. Render exactly
 *  one of these in place of the row map when there's nothing to show. */
export function TableStatus({
  span,
  loading,
  error,
  loadingText = "Loading…",
  errorText = "Couldn't load. Try again in a moment.",
  emptyText,
}: {
  span: number;
  loading: boolean;
  error: boolean;
  loadingText?: React.ReactNode;
  errorText?: React.ReactNode;
  emptyText: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={span} className="muted">
        {loading ? loadingText : error ? errorText : emptyText}
      </td>
    </tr>
  );
}

/** Block-level status for non-table layouts (hero panels, grids, the drawer body). */
export function BlockStatus({ error, text }: { error?: boolean; text?: string }) {
  return (
    <div className="empty">
      {text ?? (error ? "Couldn't load. Try again in a moment." : "Loading…")}
    </div>
  );
}
