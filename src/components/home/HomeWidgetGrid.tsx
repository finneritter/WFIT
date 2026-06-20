// The customizable lower half of the Home screen: a grid of widget tiles the
// user can add (multi-select checklist), remove, drag to reorder, and resize by
// the corner (snapping to 1×1 … 2×2). The order/sizes persist to localStorage
// (UI preference, single-user; same pattern as nav-collapsed / drawer-width).
//
// Built on plain CSS Grid (tiles flow across and fill gaps — `grid-auto-flow:
// dense`) + Pointer Events for drag/resize. We deliberately do NOT use a grid
// library: react-grid-layout's drag/resize and width measurement did not work
// in the app's WebKitGTK webview, and Pointer Events are well-supported there.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEscape } from "../../hooks/useEscape";
import { clsx } from "../../lib/format";
import { usePersisted, usePersistedJSON } from "../../lib/persist";
import { Icon } from "../Icon";
import { Scrim } from "../ui";
import { DEFAULT_LAYOUT, type Nav, WIDGETS, WIDGET_MAP } from "./widgets";

const STORAGE_KEY = "wfit.homeLayout";
// Bump to discard a layout persisted by an older schema (the previous versions
// stored x/y positions; this one stores order + size only).
const LAYOUT_VERSION = 3;
const COLS = 4;
const ROW_H = 150;
const GAP = 10;
const MAX = 2; // a tile spans at most 2 columns / 2 rows

interface Tile {
  key: string;
  w: number;
  h: number;
}
interface Stored {
  version: number;
  items: Tile[];
}

const DEFAULT_STORED: Stored = { version: LAYOUT_VERSION, items: DEFAULT_LAYOUT };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function HomeWidgetGrid({
  onOpen,
  onNavigate,
}: {
  onOpen: (slug: string) => void;
  onNavigate: Nav;
}) {
  const [stored, setStored] = usePersistedJSON<Stored>(STORAGE_KEY, DEFAULT_STORED);
  const [hintSeen, setHintSeen] = usePersisted<"0" | "1">("wfit.homeHintSeen", "0");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

  // A layout from an older schema version is discarded (reset to the default)
  // so a corrupted/legacy layout can't stick. The memo renders the default
  // immediately; the effect normalizes the stored value for later mutations.
  const items = useMemo(() => {
    const src = stored.version === LAYOUT_VERSION ? stored.items : DEFAULT_LAYOUT;
    return src.filter((it) => WIDGET_MAP[it.key]);
  }, [stored]);
  const enabled = useMemo(() => new Set(items.map((it) => it.key)), [items]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const setItems = useCallback(
    (next: Tile[]) => setStored({ version: LAYOUT_VERSION, items: next }),
    [setStored],
  );

  const migrated = useRef(false);
  useEffect(() => {
    if (!migrated.current && stored.version !== LAYOUT_VERSION) {
      migrated.current = true;
      setStored({ version: LAYOUT_VERSION, items: DEFAULT_LAYOUT });
    }
  }, [stored.version, setStored]);

  // Measure the grid so the edit-mode backdrop lines up and resize can convert
  // pointer pixels → cells. colWidth = (W − gap·(cols−1)) / cols.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const colWRef = useRef(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const colW = (w - GAP * (COLS - 1)) / COLS;
      colWRef.current = colW;
      el.style.setProperty("--hw-pitch-x", `${colW + GAP}px`);
      el.style.setProperty("--hw-pitch-y", `${ROW_H + GAP}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- FLIP animation: slide on reorder, grow/shrink on resize ----------------
  // CSS can't transition grid placement/span, so we animate it ourselves with the
  // Web Animations API: capture each tile's rect, and after `items` changes,
  // play the inverse transform → identity so it appears to move from where it was.
  const prevRects = useRef(new Map<string, DOMRect>());
  const flipAnims = useRef(new Map<string, Animation>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-capture + animate whenever the layout (items) changes, even though the body reads the DOM rather than `items` directly.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, DOMRect>();
    for (const el of grid.querySelectorAll<HTMLElement>(".hw[data-key]")) {
      const key = el.dataset.key;
      if (!key) continue;
      const now = el.getBoundingClientRect();
      next.set(key, now);
      const prev = prevRects.current.get(key);
      if (
        !reduce &&
        prev &&
        (prev.left !== now.left ||
          prev.top !== now.top ||
          prev.width !== now.width ||
          prev.height !== now.height)
      ) {
        flipAnims.current.get(key)?.cancel();
        const anim = el.animate(
          [
            {
              transformOrigin: "top left",
              transform: `translate(${prev.left - now.left}px, ${prev.top - now.top}px) scale(${
                prev.width / now.width
              }, ${prev.height / now.height})`,
            },
            { transformOrigin: "top left", transform: "none" },
          ],
          { duration: 200, easing: "cubic-bezier(.2,.7,.3,1)" },
        );
        flipAnims.current.set(key, anim);
      }
    }
    prevRects.current = next;
  }, [items]);

  // ---- drag to reorder (pointer events on the tile) --------------------------
  const startDrag = useCallback(
    (e: React.PointerEvent, key: string) => {
      if (!editing) return;
      e.preventDefault();
      setDragKey(key);
      const move = (ev: PointerEvent) => {
        const cur = itemsRef.current;
        const dragItem = cur.find((i) => i.key === key);
        if (!dragItem) return;
        const others = cur.filter((i) => i.key !== key);
        // Reading-order insertion index from the pointer vs the other tiles.
        let idx = others.length;
        for (let i = 0; i < others.length; i++) {
          const el = gridRef.current?.querySelector<HTMLElement>(`[data-key="${others[i].key}"]`);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const aboveRow = ev.clientY < r.top;
          const sameRowLeft =
            ev.clientY >= r.top && ev.clientY <= r.bottom && ev.clientX < r.left + r.width / 2;
          if (aboveRow || sameRowLeft) {
            idx = i;
            break;
          }
        }
        const next = [...others.slice(0, idx), dragItem, ...others.slice(idx)];
        if (next.some((n, i) => n.key !== cur[i]?.key)) setItems(next);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setDragKey(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [editing, setItems],
  );

  // ---- resize by the SE corner (pointer events, delta-based) -----------------
  const startResize = useCallback(
    (e: React.PointerEvent, key: string) => {
      e.preventDefault();
      e.stopPropagation(); // don't also start a drag
      const def = WIDGET_MAP[key];
      const start = itemsRef.current.find((i) => i.key === key);
      if (!def || !start) return;
      const x0 = e.clientX;
      const y0 = e.clientY;
      const w0 = start.w;
      const h0 = start.h;
      const pitchX = (colWRef.current || 1) + GAP;
      const pitchY = ROW_H + GAP;
      const move = (ev: PointerEvent) => {
        const w = clamp(w0 + Math.round((ev.clientX - x0) / pitchX), def.min?.w ?? 1, MAX);
        const h = clamp(h0 + Math.round((ev.clientY - y0) / pitchY), def.min?.h ?? 1, MAX);
        const cur = itemsRef.current;
        const t = cur.find((i) => i.key === key);
        if (t && (t.w !== w || t.h !== h)) {
          setItems(cur.map((i) => (i.key === key ? { ...i, w, h } : i)));
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [setItems],
  );

  const addWidget = useCallback(
    (key: string) => {
      const cur = itemsRef.current;
      if (cur.some((it) => it.key === key)) return;
      const def = WIDGET_MAP[key];
      if (!def) return;
      setItems([...cur, { key, w: def.default.w, h: def.default.h }]);
    },
    [setItems],
  );
  const removeWidget = useCallback(
    (key: string) => setItems(itemsRef.current.filter((it) => it.key !== key)),
    [setItems],
  );
  const toggleWidget = useCallback(
    (key: string) => (enabled.has(key) ? removeWidget(key) : addWidget(key)),
    [enabled, addWidget, removeWidget],
  );

  const startEditing = useCallback(() => {
    setEditing(true);
    setHintSeen("1");
  }, [setHintSeen]);

  return (
    <div className="hw-wrap" ref={wrapRef}>
      <div className="hw-bar">
        {hintSeen === "0" && !editing ? (
          <span className="hw-hint">Make this yours — add and arrange widgets →</span>
        ) : (
          <span className="hw-bar-sp" />
        )}
        <div className="hw-bar-actions">
          {editing ? (
            <button type="button" className="btn sm" onClick={() => setAdding(true)}>
              + Add widget
            </button>
          ) : null}
          <button
            type="button"
            className={clsx("btn sm", editing && "pri")}
            onClick={() => (editing ? setEditing(false) : startEditing())}
          >
            {editing ? "Done" : "Customize"}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="hw-blank">
          <div className="hw-blank-t">Your home is empty</div>
          <div className="hw-blank-s">Add widgets to track what matters at a glance.</div>
          <button type="button" className="btn pri" onClick={() => setAdding(true)}>
            + Add widget
          </button>
        </div>
      ) : (
        <div className={clsx("hw-grid", editing && "editing")} ref={gridRef}>
          {items.map((it) => {
            const def = WIDGET_MAP[it.key];
            const Render = def.Render;
            return (
              <div
                key={it.key}
                data-key={it.key}
                className={clsx("hw", editing && "editing", dragKey === it.key && "dragging")}
                style={{ ["--w" as string]: it.w, ["--h" as string]: it.h }}
                onPointerDown={editing ? (e) => startDrag(e, it.key) : undefined}
              >
                <div className="hw-card">
                  <div className="hw-h">
                    <Icon name={def.icon} />
                    {editing ? (
                      <>
                        <span className="hw-t">{def.title}</span>
                        <button
                          type="button"
                          className="hw-x"
                          title="Remove widget"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => removeWidget(it.key)}
                        >
                          ×
                        </button>
                      </>
                    ) : def.screen ? (
                      <button
                        type="button"
                        className="hw-t hw-nav"
                        onClick={() => onNavigate(def.screen!)}
                      >
                        {def.title}
                        <span className="hw-go">→</span>
                      </button>
                    ) : (
                      <span className="hw-t">{def.title}</span>
                    )}
                  </div>
                  <Render w={it.w} h={it.h} onOpen={onOpen} onNavigate={onNavigate} />
                </div>
                {editing ? (
                  <button
                    type="button"
                    className="hw-resize"
                    aria-label="Resize widget"
                    onPointerDown={(e) => startResize(e, it.key)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <AddWidgetModal
          enabled={enabled}
          onToggle={toggleWidget}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-widget checklist — multiple widgets can be toggled at once.
// ---------------------------------------------------------------------------

const GROUPS = ["Overview", "Portfolio", "Trading", "Planning", "World"] as const;

function AddWidgetModal({
  enabled,
  onToggle,
  onClose,
}: {
  enabled: Set<string>;
  onToggle: (key: string) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  return (
    <Scrim onClose={onClose}>
      <div className="hw-add">
        <div className="hw-add-h">
          <h2>Add widgets</h2>
          <span className="hw-add-c">{enabled.size} enabled</span>
          <button type="button" className="btn sm" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="hw-add-b">
          {GROUPS.map((group) => {
            const defs = WIDGETS.filter((d) => d.group === group);
            if (defs.length === 0) return null;
            return (
              <div className="hw-add-grp" key={group}>
                <div className="hw-add-gt">{group}</div>
                {defs.map((d) => {
                  const on = enabled.has(d.key);
                  return (
                    <button
                      type="button"
                      key={d.key}
                      className={clsx("hw-add-row", on && "on")}
                      aria-pressed={on}
                      onClick={() => onToggle(d.key)}
                    >
                      <span className="hw-add-chk">{on ? "✓" : ""}</span>
                      <Icon name={d.icon} />
                      <span className="hw-add-n">{d.title}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </Scrim>
  );
}
