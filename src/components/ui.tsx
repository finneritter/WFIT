// Small shared presentational primitives used across screens.
import { memo, useEffect } from "react";
import { clsx, glyph, tier } from "../lib/format";

// Ref-counted background-scroll lock: while any Scrim is mounted, the page's
// scroll container is frozen so the wheel scrolls the modal, not the page behind.
let scrimLocks = 0;

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

/** The item name cell used by every table screen: tier glyph + display name
 *  (+ inline tags) over a muted sub line. One component instead of the same
 *  .dnm/.di markup copy-pasted per route. */
export function ItemName({
  name,
  plat,
  thumb,
  sub,
  tags,
  noGlyph,
}: {
  name: string;
  plat: number | null | undefined;
  thumb?: string | null;
  sub?: React.ReactNode;
  tags?: React.ReactNode;
  /** Plain-text cell — skip the letter/thumb tile (e.g. relic rows, where the
   *  name itself already carries the tier). */
  noGlyph?: boolean;
}) {
  return (
    <div className="dnm">
      {noGlyph ? null : <Glyph name={name} plat={plat} thumb={thumb} />}
      <div className="di">
        <span className="nm">
          {name}
          {tags}
        </span>
        {sub != null ? <span className="sub">{sub}</span> : null}
      </div>
    </div>
  );
}

/** A clickable, sortable column header. Presentational — pair with `useColumnSort`
 *  (hooks/useTable.ts) for the cycle/persist logic. `right` mirrors the `.r`
 *  numeric alignment. Renders the active-direction arrow + aria-sort. */
export function SortTh<K extends string>({
  label,
  col,
  sort,
  onSort,
  right,
}: {
  label: React.ReactNode;
  col: K;
  sort: { key: K; dir: "asc" | "desc" } | null;
  onSort: (key: K) => void;
  right?: boolean;
}) {
  const active = sort?.key === col;
  return (
    <th
      className={clsx(right && "r")}
      aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={clsx("th-sort", active && "sorted")}
        onClick={() => onSort(col)}
      >
        {label}
        {active ? <span className="sort-arr">{sort?.dir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}

/** Click + keyboard activation props for an interactive table row:
 *  spread onto a <tr> to make it Tab-focusable and Enter/Space-activatable.
 *  Inner controls keep working — keyboard activation only fires when the row
 *  itself has focus, and clicks on cells that stopPropagation stay theirs. */
export function rowAction(activate: () => void) {
  return {
    tabIndex: 0,
    onClick: activate,
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
        e.preventDefault();
        activate();
      }
    },
  };
}

/** Modal backdrop: clicking the backdrop itself (not anything inside it)
 *  closes. Children need no stopPropagation. Every modal pairs this with
 *  useEscape — Escape is the keyboard path, the click is pointer-only. */
export function Scrim({
  onClose,
  className = "modal-scrim",
  children,
}: {
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  // Freeze the background scroll for as long as this modal is open.
  useEffect(() => {
    scrimLocks += 1;
    document.body.classList.add("modal-open");
    return () => {
      scrimLocks -= 1;
      if (scrimLocks <= 0) {
        scrimLocks = 0;
        document.body.classList.remove("modal-open");
      }
    };
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape (useEscape) is the keyboard equivalent
    <div
      className={className}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
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
