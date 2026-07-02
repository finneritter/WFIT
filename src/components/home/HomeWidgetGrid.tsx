// The customizable lower half of the Home screen: a grid of widget tiles the
// user can add (multi-select checklist), remove, drag to move, and resize by
// the corner (snapping to 1×1 … 2×2). The layout persists to localStorage
// (UI preference, single-user; same pattern as nav-collapsed / drawer-width).
//
// Built on plain CSS Grid with freeform placement (each tile stores explicit
// x/y and spans; gaps are allowed, dropping onto a tile pushes overlapped
// tiles down — see resolveDown) + Pointer Events for drag/resize. We
// deliberately do NOT use a grid library: react-grid-layout's drag/resize and
// width measurement did not work in the app's WebKitGTK webview, and Pointer
// Events are well-supported there.
//
// Outside edit mode a click on a tile's body "focuses" it: the row list drops
// its cap and scrolls inside the tile. Long-pressing a tile enters edit mode.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEscape } from "../../hooks/useEscape";
import { clsx } from "../../lib/format";
import { usePersisted, usePersistedJSON } from "../../lib/persist";
import { Icon } from "../Icon";
import { Scrim } from "../ui";
import { DEFAULT_LAYOUT, type Nav, WIDGETS, WIDGET_MAP } from "./widgets";

const STORAGE_KEY = "wfit.homeLayout";
// Bump to discard a layout persisted by an older schema. v4 = freeform x/y
// placement (gaps allowed); earlier versions stored order-only or absolute px.
const LAYOUT_VERSION = 4;
const COLS = 4;
const ROW_H = 150;
const GAP = 10;
const MAX = 2; // a tile spans at most 2 columns / 2 rows

interface Tile {
  key: string;
  x: number; // column (0..COLS-w)
  y: number; // row (0..)
  w: number;
  h: number;
}
interface Stored {
  version: number;
  items: Tile[];
}

const DEFAULT_STORED: Stored = { version: LAYOUT_VERSION, items: DEFAULT_LAYOUT };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ---- freeform-grid geometry helpers ----------------------------------------
const overlaps = (a: Tile, b: Tile) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const bottomOf = (tiles: Tile[]) => tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0);

// Place `moved` at its chosen cell and push any tile it overlaps straight DOWN
// (cascading onto whatever they then hit). Every other tile starts from its
// original y, so tiles you aren't disturbing stay put — and they spring back
// the moment `moved` slides off them (we always resolve from the committed
// layout, never an accumulated one). iOS-widget feel: only collisions move.
function resolveDown(others: Tile[], moved: Tile): Tile[] {
  const placed: Tile[] = [moved];
  const out: Tile[] = [];
  for (const t of [...others].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const nt = { ...t };
    let guard = 0;
    while (placed.some((p) => overlaps(nt, p)) && guard++ < 500) nt.y += 1;
    placed.push(nt);
    out.push(nt);
  }
  return out;
}

// First open cell (reading order) that fits a w×h tile without overlapping any.
function firstFree(tiles: Tile[], w: number, h: number): { x: number; y: number } {
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x <= COLS - w; x++) {
      const cand: Tile = { key: "", x, y, w, h };
      if (!tiles.some((t) => overlaps(cand, t))) return { x, y };
    }
  }
  return { x: 0, y: bottomOf(tiles) };
}

const layoutSig = (tiles: Tile[]) =>
  tiles.map((t) => `${t.key}:${t.x}:${t.y}:${t.w}:${t.h}`).join("|");

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
  // Click-to-focus: the focused tile's row list uncaps and scrolls (WidgetBody).
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  // Transient order while a drag is in flight. The grid renders from this so
  // the other tiles reflow live, but we DON'T persist on every pointermove (that
  // wrote to localStorage per-move) — only commit on drop.
  const [draft, setDraft] = useState<Tile[] | null>(null);
  const draftRef = useRef<Tile[] | null>(null);
  draftRef.current = draft;
  // The grabbed tile is rendered as a separate absolutely-positioned overlay
  // that floats with the cursor, fully decoupled from its grid slot (so a slot
  // that moves under it during reorder can't make it jump). A static dashed
  // placeholder holds its slot in the grid. translate3d → its own GPU layer, so
  // the moving box-shadow composites cleanly instead of leaving repaint trails.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const grab = useRef({ dx: 0, dy: 0, w: 0, h: 0 });
  const lastPt = useRef({ x: 0, y: 0 });

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
  // What the grid actually renders: the in-flight draft while dragging, else the
  // committed order. Keeps the dragged tile's placeholder reflowing the others.
  const order = draft ?? items;

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
  // Signature of the rendered layout so the effect re-runs on move/resize.
  const orderSig = layoutSig(order);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-capture + animate whenever the layout changes (tracked via orderSig); the body reads the DOM rather than the order array directly.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // The overlay (the grabbed clone) has no data-key, so it's excluded — only the
    // settled tiles + the placeholder slide. This runs once per reorder (a setDraft
    // re-render), not per pointermove, so it stays smooth and doesn't thrash.
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
          { duration: 180, easing: "cubic-bezier(.2,.7,.3,1)" },
        );
        flipAnims.current.set(key, anim);
      }
    }
    prevRects.current = next;
  }, [orderSig, dragKey]);

  // ---- drag to reorder (pointer events on the tile) --------------------------
  // The grabbed tile becomes a floating overlay (positioned in grid-relative px,
  // independent of any slot); a dashed placeholder holds its place in the grid
  // and the others reflow around it. Only the overlay moves per pointermove —
  // imperatively, no React re-render — so nothing in the grid repaints mid-drag.
  const positionOverlay = useCallback((clientX: number, clientY: number) => {
    const grid = gridRef.current;
    const ov = overlayRef.current;
    if (!grid || !ov) return;
    const gr = grid.getBoundingClientRect();
    const x = clientX - gr.left - grab.current.dx;
    const y = clientY - gr.top - grab.current.dy;
    ov.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, []);

  // Place the overlay over the grabbed tile the instant it mounts (before paint),
  // so it never flashes at the grid's top-left for a frame.
  useLayoutEffect(() => {
    if (dragKey) positionOverlay(lastPt.current.x, lastPt.current.y);
  }, [dragKey, positionOverlay]);

  const startDrag = useCallback(
    (e: React.PointerEvent, key: string) => {
      if (!editing) return;
      e.preventDefault();
      const tileEl = gridRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`);
      const tr = tileEl?.getBoundingClientRect();
      // Where in the tile we grabbed + the tile's pixel size (for the overlay).
      grab.current = {
        dx: tr ? e.clientX - tr.left : 0,
        dy: tr ? e.clientY - tr.top : 0,
        w: tr?.width ?? 0,
        h: tr?.height ?? 0,
      };
      lastPt.current = { x: e.clientX, y: e.clientY };
      draftRef.current = itemsRef.current.slice();
      setDraft(draftRef.current);
      setDragKey(key); // overlay positioned by the layout effect on mount
      const move = (ev: PointerEvent) => {
        lastPt.current = { x: ev.clientX, y: ev.clientY };
        positionOverlay(ev.clientX, ev.clientY);
        const grid = gridRef.current;
        if (!grid) return;
        // Snap the overlay's top-left to the nearest grid cell → target (tx,ty).
        // We resolve from the COMMITTED layout each move (itemsRef, unchanged until
        // drop) so tiles you aren't overlapping return home when you move off them.
        const base = itemsRef.current;
        const moving = base.find((t) => t.key === key);
        if (!moving) return;
        const others = base.filter((t) => t.key !== key);
        const gr = grid.getBoundingClientRect();
        const pitchX = (colWRef.current || 1) + GAP;
        const pitchY = ROW_H + GAP;
        const tx = clamp(
          Math.round((ev.clientX - gr.left - grab.current.dx) / pitchX),
          0,
          COLS - moving.w,
        );
        // Allow dropping at most one row below the lowest tile (no floating voids).
        const ty = clamp(
          Math.round((ev.clientY - gr.top - grab.current.dy) / pitchY),
          0,
          bottomOf(others),
        );
        const movedTile: Tile = { ...moving, x: tx, y: ty };
        const placed = new Map<string, Tile>([[key, movedTile]]);
        for (const t of resolveDown(others, movedTile)) placed.set(t.key, t);
        // Keep array order stable (placement is absolute) so React/FLIP diff cleanly.
        const next = base.map((t) => placed.get(t.key) ?? t);
        if (layoutSig(next) !== layoutSig(draftRef.current ?? base)) {
          draftRef.current = next;
          setDraft(next);
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const final = draftRef.current;
        // Seed the dropped tile's FLIP "from" rect with the overlay's last position
        // so it glides from the cursor into its slot instead of teleporting.
        const ov = overlayRef.current;
        if (ov) prevRects.current.set(key, ov.getBoundingClientRect());
        setDragKey(null);
        setDraft(null);
        draftRef.current = null;
        if (final) setItems(final); // single localStorage write on drop
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [editing, setItems, positionOverlay],
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
      const sx = start.x;
      const sy = start.y;
      const pitchX = (colWRef.current || 1) + GAP;
      const pitchY = ROW_H + GAP;
      // Resize previews into the draft (live push) and commits once on release —
      // same model as drag, so growing a tile shoves neighbours down and shrinking
      // lets them spring back.
      draftRef.current = itemsRef.current.slice();
      const move = (ev: PointerEvent) => {
        const w = clamp(
          w0 + Math.round((ev.clientX - x0) / pitchX),
          def.min?.w ?? 1,
          Math.min(MAX, COLS - sx),
        );
        const h = clamp(h0 + Math.round((ev.clientY - y0) / pitchY), def.min?.h ?? 1, MAX);
        const base = itemsRef.current;
        const others = base.filter((t) => t.key !== key);
        const resized: Tile = { key, x: sx, y: sy, w, h };
        const placed = new Map<string, Tile>([[key, resized]]);
        for (const t of resolveDown(others, resized)) placed.set(t.key, t);
        const next = base.map((t) => placed.get(t.key) ?? t);
        if (layoutSig(next) !== layoutSig(draftRef.current ?? base)) {
          draftRef.current = next;
          setDraft(next);
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const final = draftRef.current;
        setDraft(null);
        draftRef.current = null;
        if (final) setItems(final);
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
      const { w, h } = def.default;
      const { x, y } = firstFree(cur, w, h);
      setItems([...cur, { key, x, y, w, h }]);
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
    setFocusedKey(null);
    setHintSeen("1");
  }, [setHintSeen]);

  // ---- click-to-focus + long-press-to-edit (non-edit mode only) ---------------
  // Escape or a click outside the focused tile releases focus.
  useEffect(() => {
    if (!focusedKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusedKey(null);
    };
    const onDown = (e: PointerEvent) => {
      const el = gridRef.current?.querySelector(`[data-key="${focusedKey}"]`);
      if (el && e.target instanceof Node && !el.contains(e.target)) setFocusedKey(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [focusedKey]);

  // Focus on body click — but never steal a click meant for a row/input/link.
  const onTileClick = useCallback((e: React.MouseEvent, key: string) => {
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    setFocusedKey((k) => (k === key ? null : key));
  }, []);

  // Long-press (~500ms, no movement) = enter edit mode, the gesture users try
  // first. The click that follows the release is swallowed so it can't also
  // focus a tile or open a drawer row.
  const pressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const beginPress = useCallback(
    (e: React.PointerEvent) => {
      const sx = e.clientX;
      const sy = e.clientY;
      const cancel = () => {
        if (pressTimer.current != null) window.clearTimeout(pressTimer.current);
        pressTimer.current = null;
        window.removeEventListener("pointerup", cancel);
        window.removeEventListener("pointermove", onMove);
      };
      const onMove = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) cancel();
      };
      pressTimer.current = window.setTimeout(() => {
        cancel();
        suppressClick.current = true;
        startEditing();
      }, 500);
      window.addEventListener("pointerup", cancel);
      window.addEventListener("pointermove", onMove);
    },
    [startEditing],
  );
  const onTileClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const dragItem = dragKey ? order.find((i) => i.key === dragKey) : null;
  const dragDef = dragItem ? WIDGET_MAP[dragItem.key] : null;
  const DragRender = dragDef?.Render;

  return (
    <div className="hw-wrap" ref={wrapRef}>
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
          {order.map((it) => {
            const def = WIDGET_MAP[it.key];
            const Render = def.Render;
            // The grabbed tile is drawn by the floating overlay below; in the
            // grid it leaves a dashed placeholder holding its slot.
            const place = {
              gridColumn: `${it.x + 1} / span ${it.w}`,
              gridRow: `${it.y + 1} / span ${it.h}`,
            };
            if (dragKey === it.key) {
              return (
                <div key={it.key} data-key={it.key} className="hw hw-placeholder" style={place} />
              );
            }
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: body-click focus is a pointer convenience — rows stay real buttons and Escape releases focus
              <div
                key={it.key}
                data-key={it.key}
                className={clsx("hw", editing && "editing", focusedKey === it.key && "focused")}
                style={place}
                onPointerDown={editing ? (e) => startDrag(e, it.key) : beginPress}
                onClickCapture={onTileClickCapture}
                onClick={editing ? undefined : (e) => onTileClick(e, it.key)}
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
                  <Render
                    w={it.w}
                    h={it.h}
                    onOpen={onOpen}
                    onNavigate={onNavigate}
                    focused={focusedKey === it.key}
                  />
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

          {editing && !dragKey
            ? (() => {
                // Ghost "+" tile in the first open 1×1 cell — a quicker path to the
                // Add checklist while arranging. No data-key, so FLIP ignores it.
                const { x, y } = firstFree(order, 1, 1);
                return (
                  <button
                    type="button"
                    className="hw hw-ghost"
                    style={{ gridColumn: `${x + 1} / span 1`, gridRow: `${y + 1} / span 1` }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setAdding(true)}
                  >
                    +
                  </button>
                );
              })()
            : null}

          {dragItem && dragDef && DragRender ? (
            <div
              ref={overlayRef}
              className="hw hw-overlay"
              style={{ width: grab.current.w, height: grab.current.h }}
            >
              <div className="hw-card">
                <div className="hw-h">
                  <Icon name={dragDef.icon} />
                  <span className="hw-t">{dragDef.title}</span>
                </div>
                <DragRender w={dragItem.w} h={dragItem.h} onOpen={onOpen} onNavigate={onNavigate} />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {items.length > 0 ? (
        <div className={clsx("hw-bar", editing && "editing")}>
          {hintSeen === "0" && !editing ? (
            <span className="hw-hint">Make this yours — add and arrange widgets</span>
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
      ) : null}

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
