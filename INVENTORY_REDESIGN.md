# Handoff: WFIT — Inventory Display Overhaul (Update 2, implementation spec)

> **Scope is deliberately narrow.** This document specifies **only** the changes to the **Inventory screen's item rendering and its filter toolbar**. It is written so an engineer (or Claude Code) can reproduce these changes **surgically, without touching any other screen, the data model, routing, or global styles** — because the rest of the app has diverged from the reference build.
>
> Treat the reference code blocks as the **source of truth for values and structure**, but adapt class names / tokens / component boundaries to whatever the live codebase already uses (see §1 mapping). When in doubt, match *behavior and exact pixel/weight values*, not my exact markup.

---

## 0. Scope — what to change and what to leave alone

### ✅ In scope (only these)
1. **Inventory tile legibility** — value-label typography, magnify-on-hover, 3-step tile size, optional label-density modes.
2. **Two new Inventory layouts** — "Chips" and "List", in addition to the existing tile "Grid".
3. **A view switcher** (Grid / Chips / List) with `localStorage` persistence.
4. **Inventory filter toolbar** — replace the chip rows with one `Hot` toggle + `Category` / `Sort` / `View` dropdowns, all the same height.

### ⛔ Out of scope — DO NOT modify
- Any other screen (Sets, Trends, Watchlist, Buy List, Listings, Ducats, Rotation, Sold History).
- The Detail Drawer, Add-Items modal, Sidebar, Top bar, Stat band.
- The data model / state shape / API layer / item objects.
- Global design tokens, shared table styles (`.dtable`), or the `.chip` base style **except** to add the scoped overrides in §2.6.
- Any component **not** named in §4–§6.

### Files the reference build touches
- `WFIT Wireframe.html` — **CSS only** (the additions in §2). No structural HTML.
- `wireframe.jsx` — the `Inventory`, `Section` components; new `Chip`, `InvTable`, `Dropdown` components; 5 new `Icon` glyphs; (optional) Tweaks wiring.

In your codebase these likely map to an `Inventory` view module + its stylesheet. **Add new classes; do not repurpose existing ones.** Everything new is namespaced (`.viewsel/.viewbtn/.viewmenu/.viewopt`, `.chips/.chip-it/.ci-*`, `.inv-tbl`, `body.tile-lg/.labels-hi/.labels-hover/.no-magnify`) precisely so it can't collide.

---

## 1. Dependencies this code references (map to your equivalents)

The reference snippets use these **existing** tokens/classes. If your build renamed them, substitute throughout — do not redefine them here.

| Reference name | Meaning | If yours differs… |
|---|---|---|
| `--mono` / `--sans` | mono (tabular) / sans font stacks | map to your font vars |
| `--bg-2` | elevated surface (menus) | menu/popover bg |
| `--panel` / `--panel-2` | control bg / tile fill | input & card surfaces |
| `--line` / `--line-2` | hairline / stronger border | your border tokens |
| `--ink` / `--soft` / `--faint` | text high/med/low | your text scale |
| `--hover` | hover background | hover token |
| `--accent` | highlight (check mark, outline) | accent token |
| `--pos` / `--neg` / `--hot` | up green / down red / hot amber | your semantic colors |
| `--t-exotic/legend/rare/basic` | value-tier edge colors (`≥120 / ≥45 / ≥15 / <15` plat) | your rarity/tier colors |
| `--tile` | tile edge length (default `46px`) | your tile size var |
| `.tile` (+ `.t-*`, `.glyph`, `.qty`, `.ct-tl`, `.trend`, `.vbar .pl`, `.sold`) | existing square tile | your tile component |
| `.grid` | wrapping flex of tiles | your tile container |
| `.section` / `.sec-h` (`.tw/.ct/.tot`) | collapsible section + header | keep as-is across all 3 views |
| `.dtable` (`.dnm/.gl/.di/.nm/.sub`, `td.r`, `.num`) | the app's shared data table | List view reuses it |
| `.filters` / `.search` / `.chip` / `.sortlbl` / `.sp` / `.legend` | the inventory toolbar pieces | your toolbar |
| `tier(plat)` / `initials(name)` / `fmt(n)` | helpers (below) | reuse yours if present |
| `MiniSpark` | tiny sparkline (§4.4) | reuse your sparkline if present |

Helper contracts (reference impls — reuse yours if equivalent):
```js
const tier = (p) => p >= 120 ? "exotic" : p >= 45 ? "legend" : p >= 15 ? "rare" : "basic";
const fmt  = (n) => n.toLocaleString("en-US");
// 2-letter glyph stand-in for the item icon; in production the icon image replaces this
const initials = (n) => n.replace(/ Prime.*/, "").replace(/^(Primed|Arcane|Galvanized)\s*/, "").trim().slice(0, 2).toUpperCase();
```

> **Item icons:** the reference renders a 2-letter mono glyph as a placeholder. In the real app, the **icon image is the visual anchor** of Grid and Chips views, and the small glyph in List. Wherever you see `initials(it.name)`, render your item icon instead (keep the same box sizes: 30px in chips, 26px in the list, full-cell in grid).

---

## 2. CSS to add (verbatim)

Add these blocks to the Inventory stylesheet. They are all additive and namespaced. Grouped by concern.

### 2.1 Tile size — 3 steps
The default tile is `--tile: 46px`. Add a **large** step; keep your existing **compact** step if present.
```css
body.dense   { --tile: 40px; }   /* "Compact" — keep if you already have it */
body.tile-lg { --tile: 62px; }   /* "Large" — NEW */
```

### 2.2 Tile value label + magnify-on-hover (legibility core)
Replace the existing `.tile .vbar`, `.tile .vbar .pl`, `.tile .glyph`, `.tile .trend`, and `.tile:hover` rules with these (note the bumped sizes/contrast and the new `transition` + magnify rule):
```css
.tile { /* …keep your existing tile rule, and ADD: */ transition: transform .09s ease, box-shadow .09s ease; }
.tile:hover { outline: 2px solid var(--accent); outline-offset: -1px; z-index: 30; }
/* magnify-on-hover: pop the pointed tile out so its number is instantly readable */
body:not(.no-magnify) .tile:hover { transform: scale(1.7); box-shadow: 0 8px 22px rgba(0,0,0,.7); }

.tile .glyph { position: absolute; inset: 0 0 14px; display: grid; place-items: center; font-family: var(--mono); font-weight: 700; font-size: 14px; color: var(--soft); letter-spacing: .02em; }
body.tile-lg .tile .glyph { font-size: 18px; }

.tile .vbar { position: absolute; left: 0; right: 0; bottom: 0; height: 14px; background: #06070a; border-top: 1px solid var(--line-2); display: flex; align-items: center; justify-content: flex-end; padding: 0 3px 0 6px; z-index: 2; }
.tile .vbar .pl { font-family: var(--mono); font-size: 11px; font-weight: 700; color: #fff; letter-spacing: -.02em; line-height: 1; }
body.tile-lg .tile .vbar { height: 17px; }
body.tile-lg .tile .vbar .pl { font-size: 13px; }

.tile .trend { position: absolute; left: 0; bottom: 0; width: 3px; height: 14px; z-index: 3; }
```
**Key deltas vs. the old tile:** value bar `13px → 14px` tall, bg `var(--bg) → #06070a` (darker for contrast), border-top `--line → --line-2`, left-padding `3px → 6px` (clears the trend strip); value label `10px/600/--ink → 11px/700/#fff`; hover `z-index 5 → 30` and the magnify transform. Glyph & trend heights track the new bar (`13 → 14`).

### 2.3 Label-density modes (optional de-clutter)
```css
/* quiet cheap tiles to colored chips, reveal their number on hover */
body.labels-hi .tile:not(.t-legend):not(.t-exotic) .vbar,
body.labels-hover .tile .vbar { display: none; }
body.labels-hi .tile:not(.t-legend):not(.t-exotic) .glyph,
body.labels-hover .tile .glyph { inset: 0; }                 /* glyph fills the cell when label hidden */
body.labels-hi .tile:not(.t-legend):not(.t-exotic):hover .vbar,
body.labels-hover .tile:hover .vbar { display: flex; }
```
- `labels-hi` → only `t-legend`/`t-exotic` (≥45p) keep a visible value; cheaper tiles reveal on hover.
- `labels-hover` → no tile shows a value until hover.
- Neither class set → all values show (default).

### 2.4 View switcher (dropdown) — reused for Category, Sort, View
```css
.viewsel { position: relative; }
.viewbtn { display: flex; align-items: center; gap: 6px; font-family: var(--sans); font-size: 11.5px; color: var(--soft); background: var(--panel); border: 1px solid var(--line-2); padding: 4px 9px; cursor: pointer; }
.viewbtn:hover { color: var(--ink); border-color: var(--soft); }
.viewbtn b { color: var(--ink); font-weight: 600; text-transform: capitalize; }
.viewbtn svg { width: 14px; height: 14px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.viewbtn .cv { color: var(--faint); font-size: 9px; margin-left: 1px; }   /* the ▾ caret */
.viewmenu { position: absolute; left: 0; top: calc(100% + 3px); z-index: 40; min-width: 150px; background: var(--bg-2); border: 1px solid var(--line-2); box-shadow: 0 8px 22px rgba(0,0,0,.55); }
.viewmenu.r { left: auto; right: 0; }   /* right-anchored so right-side menus don't clip */
.viewopt { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; font-family: var(--sans); font-size: 12px; color: var(--soft); background: transparent; border: none; padding: 7px 11px; cursor: pointer; }
.viewopt + .viewopt { border-top: 1px solid var(--line); }
.viewopt:hover { background: var(--hover); color: var(--ink); }
.viewopt.on { color: var(--ink); font-weight: 600; background: var(--hover); }
.viewopt svg { width: 14px; height: 14px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.viewopt .ck { margin-left: auto; color: var(--accent); font-size: 11px; }   /* the ✓ on the active option */
```

### 2.5 Chips view
```css
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 9px 0 2px; }
.chip-it { width: 188px; height: 50px; display: flex; align-items: center; gap: 9px; padding: 0 10px 0 9px; background: var(--panel-2); border: 1px solid var(--line-2); border-left: 3px solid var(--t-basic); cursor: pointer; }
.chip-it.t-exotic { border-left-color: var(--t-exotic); } .chip-it.t-legend { border-left-color: var(--t-legend); }
.chip-it.t-rare { border-left-color: var(--t-rare); } .chip-it.t-basic { border-left-color: var(--t-basic); }
.chip-it:hover { background: var(--hover); outline: 1px solid var(--line-2); }
.chip-it.sold { opacity: .42; }
.chip-it .ci-gl { width: 30px; height: 30px; flex: none; display: grid; place-items: center; font-family: var(--mono); font-size: 10px; font-weight: 700; color: var(--soft); background: var(--panel); border: 1px solid var(--line-2); }
.chip-it .ci-mid { min-width: 0; flex: 1; }
.chip-it .ci-nm { display: block; font-size: 12px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip-it .ci-sub { display: block; font-size: 10px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip-it .ci-sub .hot { color: var(--hot); }
.chip-it .ci-r { text-align: right; flex: none; }
.chip-it .ci-pl { display: block; font-family: var(--mono); font-size: 14px; font-weight: 700; color: #fff; letter-spacing: -.02em; }
.chip-it .ci-pl .u { font-size: 9px; color: var(--faint); font-weight: 500; }
.chip-it .ci-d { display: block; font-family: var(--mono); font-size: 10px; font-weight: 600; }
.chip-it .ci-d .ci-q { color: var(--faint); }
```
> **Critical:** `.ci-nm`/`.ci-sub` MUST be `display:block` (not inline) for ellipsis truncation to work inside the flexed `.ci-mid` (which needs `min-width:0`). Inline spans overflow and collide with the price column.

### 2.6 List view (reuses the shared `.dtable`)
```css
.section .inv-tbl { margin-top: 4px; }
.inv-tbl .nm .hot { color: var(--hot); font-size: 9px; margin-left: 5px; }
.inv-tbl .tcell { display: inline-flex; align-items: center; gap: 9px; justify-content: flex-end; }
.inv-tbl .stk { font-weight: 600; color: #fff; }
```
The table itself uses your existing `.dtable` rules (`th`, `td`, `td.r` right-align + mono, `.dnm/.gl/.di/.nm/.sub` for the item cell). If your `.dtable` differs, the only requirements are: right-aligned tabular-mono numeric columns, a name/sub stacked cell, and a tier-edged glyph box (`.gl.t-*`).

### 2.7 Uniform toolbar height
```css
.filters .search { height: 30px; padding: 0 10px; }
.filters .chip,
.filters .viewbtn { height: 30px; display: inline-flex; align-items: center; padding: 0 10px; }
```
Scoped to `.filters` so it can't affect `.chip`/`.search` elsewhere. Target: every control in the inventory toolbar is exactly **30px** tall, vertically centered.

---

## 3. Behavior spec (exact)

### 3.1 Tile (Grid) — markup contract
Each tile (square, `--tile` edge) contains, in z-order: tier color on the **top border** (`.t-{tier}`), a hot mark top-left (`.ct-tl`, `▲` when `it.hot`), qty top-right (`.qty`, `×N` when `qty>1`), centered icon/glyph (`.glyph`), a 3px **trend strip** bottom-left (`.trend.up/.down/.flat` by sign of `it.d`), and a bottom **value bar** (`.vbar` → `.pl` = `{plat}p`). `title` tooltip = `"{name} — {part}\n{plat} p · {+|-}{d}% 7d · ×{qty}"`. Click → open drawer.
- **Trend sign:** `up` if `d > 1`, `down` if `d < -1`, else `flat`.

### 3.2 Three views, shared section
The collapsible **Section** (header: `▾/▸` + uppercase label + count + right-aligned `stack value {sum of plat×qty} p`) is identical in all three views. Only the body swaps:
- `grid` → `.grid` of `.tile`.
- `chips` → `.chips` of `.chip-it`.
- `list` → `.inv-tbl` (a `.dtable`).
Empty section body → `<div class="empty">No parts match.</div>`.

### 3.3 Chips item contract
`.chip-it.t-{tier}` (+`.sold`) → icon(30px) · `.ci-mid` { `.ci-nm`=name (ellipsis), `.ci-sub`= (`▲ ` in `--hot` if hot)+part } · `.ci-r` { `.ci-pl`=`{plat}`+`<span class=u>p</span>`, `.ci-d` (`pos`/`neg` by `d>=0`)=`{+|-}{d}%` + (` ×{qty}` in `.ci-q` if qty>1) }. Click → drawer.

### 3.4 List row contract (columns)
`Item | 7d trend | Qty | Unit | Stack`, all numeric columns right-aligned mono:
- **Item**: `.dnm` → tier-edged glyph (`.gl.t-{tier}`) + `.di`{ `.nm`=name (+`<span class=hot>▲ HOT</span>` if hot), `.sub`=part }.
- **7d trend**: `.tcell` = `<MiniSpark>` (56×20, green/red by sign) + `{+|-}{d}%` (`pos`/`neg`).
- **Qty** `×{qty}` · **Unit** `{plat}p` · **Stack** `{plat×qty}p` in `.stk` (white/600).
Click row → drawer.

### 3.5 Toolbar layout & filter logic
Left group: **search** → **`▲ Hot`** toggle (`.chip[aria-pressed]`) → **Category** dropdown. Flex **spacer** (`.sp`). Right group: `sort` label → **Sort** dropdown → **View** dropdown.
- **Hot and Category are independent axes** (this is a behavior change): `Hot` filters `it.hot`; Category filters `it.cat`. They combine (e.g. Hot + Warframe). Search is a substring match over `name + part + cat`.
- Section visibility: hide a section when `cat !== "All" && cat !== section.id`; also hide an emptied section when `hot || query` is active.
- **Sort** values: `Value · high` (plat desc), `Value · low` (plat asc), `Trend` (d desc), `Name` (name then part, locale).
- **View** persists to `localStorage["wfit-inv-view"]` (`grid` default); read on mount, write on change. Guard in try/catch.

### 3.6 Dropdown behavior
Button shows `[icon] [current label] ▾`. Opens a menu of options; each shows optional icon + label + `✓` if active. Closes on **outside click** (window click listener while open) and on select. `align="right"` adds `.r` to anchor the menu to the right edge (use for Sort & View; Category is left). The button icon is the current option's own icon if it has one (View), else the static `icon` prop (Category=funnel, Sort=sort-lines).

---

## 4. Reference components (verbatim)

> React + inline JSX from the prototype. Port structure/values to your framework; class names per §1–§2.

### 4.1 `Tile` (Grid)
```jsx
function Tile({ it, onOpen }) {
  const t = tier(it.plat);
  const tr = it.d > 1 ? "up" : it.d < -1 ? "down" : "flat";
  return (
    <div className={"tile t-" + t + (it.sold ? " sold" : "")} title={`${it.name} — ${it.part}\n${it.plat} p · ${it.d >= 0 ? "+" : ""}${it.d}% 7d · ×${it.qty}`} onClick={() => onOpen(it)}>
      <span className="ct-tl">{it.hot ? "▲" : ""}</span>
      {it.qty > 1 ? <span className="qty">×{it.qty}</span> : null}
      <span className="glyph">{initials(it.name)}</span>   {/* ← render item ICON here in production */}
      <span className={"trend " + tr}></span>
      <span className="vbar"><span className="pl">{it.plat}p</span></span>
    </div>);
}
```

### 4.2 `Chip` (Chips view)
```jsx
function Chip({ it, onOpen }) {
  const t = tier(it.plat);
  const up = it.d >= 0;
  return (
    <div className={"chip-it t-" + t + (it.sold ? " sold" : "")} title={`${it.name} — ${it.part}\n${it.plat} p · ${up ? "+" : ""}${it.d}% 7d · ×${it.qty}`} onClick={() => onOpen(it)}>
      <span className="ci-gl">{initials(it.name)}</span>   {/* ← item ICON */}
      <span className="ci-mid">
        <span className="ci-nm">{it.name}</span>
        <span className="ci-sub">{it.hot ? <span className="hot">▲ </span> : null}{it.part}</span>
      </span>
      <span className="ci-r">
        <span className="ci-pl">{it.plat}<span className="u">p</span></span>
        <span className={"ci-d " + (up ? "pos" : "neg")}>{up ? "+" : ""}{it.d}%{it.qty > 1 ? <span className="ci-q"> ×{it.qty}</span> : null}</span>
      </span>
    </div>);
}
```

### 4.3 `InvTable` (List view)
```jsx
function InvTable({ items, onOpen }) {
  return (
    <table className="dtable inv-tbl">
      <thead><tr>
        <th>Item</th><th className="r">7d trend</th><th className="r">Qty</th><th className="r">Unit</th><th className="r">Stack</th>
      </tr></thead>
      <tbody>
        {items.map((it) => {
          const up = it.d >= 0;
          return (
            <tr key={it.id} onClick={() => onOpen(it)}>
              <td><div className="dnm"><span className={"gl t-" + tier(it.plat)}>{initials(it.name)}</span><span className="di"><span className="nm">{it.name}{it.hot ? <span className="hot">▲ HOT</span> : null}</span><span className="sub">{it.part}</span></span></div></td>
              <td className="r"><span className="tcell"><MiniSpark points={it.spark} color={up ? "var(--pos)" : "var(--neg)"} w={56} h={20} /><span className={up ? "pos" : "neg"}>{up ? "+" : ""}{it.d}%</span></span></td>
              <td className="r num">×{it.qty}</td>
              <td className="r num">{it.plat}p</td>
              <td className="r num stk">{fmt(it.plat * it.qty)}p</td>
            </tr>);
        })}
      </tbody>
    </table>);
}
```

### 4.4 `MiniSpark` (reuse yours if present)
Contract: takes a `points` string of space-separated `x,y` pairs in a `0..84` (x) × `0..21` (y, up = larger) coordinate space, plus `color`, `w`, `h`; draws a single stroked polyline scaled into `w×h`. In production, build `points` from the item's real price history.
```jsx
function MiniSpark({ points, color, w = 74, h = 24 }) {
  const padX = 2, top = 3, bot = h - 3;
  const arr = points.split(" ").map((pr) => { const [x, y] = pr.split(",").map(Number); return { x: padX + x / 84 * (w - padX * 2), y: top + (1 - y / 21) * (bot - top) }; });
  const line = arr.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}><path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
```

### 4.5 `Section` (now view-aware)
```jsx
function Section({ sec, items, onOpen, view }) {
  const [open, setOpen] = useState(true);
  const tot = items.reduce((a, x) => a + x.plat * x.qty, 0);
  return (
    <div className="section">
      <div className="sec-h" onClick={() => setOpen((o) => !o)}>
        <span className="tw">{open ? "▾" : "▸"}</span>
        <h2>{sec.label}</h2>
        <span className="ct">{items.length}</span>
        <span className="tot">stack value <b>{fmt(tot)} p</b></span>
      </div>
      {open ? (
        items.length === 0 ?
          <div className="empty">No parts match.</div> :
        view === "chips" ?
          <div className="chips">{items.map((it) => <Chip key={it.id} it={it} onOpen={onOpen} />)}</div> :
        view === "list" ?
          <InvTable items={items} onOpen={onOpen} /> :
          <div className="grid">{items.map((it) => <Tile key={it.id} it={it} onOpen={onOpen} />)}</div>
      ) : null}
    </div>);
}
```

### 4.6 `Dropdown` (Category / Sort / View)
```jsx
const VIEWS = [["grid", "Grid", "grid"], ["chips", "Chips", "chips"], ["list", "List", "rows"]];

function Dropdown({ icon, value, options, onChange, align = "left", title }) {
  const [open, setOpen] = useState(false);
  React.useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, [open]);
  const cur = options.find((o) => o[0] === value) || options[0];
  const btnIcon = cur[2] || icon;            // per-option icon (View) wins, else static prop
  return (
    <div className="viewsel" onClick={(e) => e.stopPropagation()}>
      <button className="viewbtn" title={title} onClick={() => setOpen((o) => !o)}>
        {btnIcon ? <Icon name={btnIcon} size={14} /> : null}<b>{cur[1]}</b><span className="cv">▾</span>
      </button>
      {open ?
        <div className={"viewmenu" + (align === "right" ? " r" : "")}>
          {options.map(([k, l, ic]) =>
            <button key={k} className={"viewopt" + (k === value ? " on" : "")} onClick={() => { onChange(k); setOpen(false); }}>
              {ic ? <Icon name={ic} size={14} /> : null}<span>{l}</span>{k === value ? <span className="ck">✓</span> : null}
            </button>)}
        </div> : null}
    </div>);
}
```
Option tuple = `[value, label, optionalIconName]`.

---

## 5. Integrate into the Inventory screen

Replace the Inventory component's state, toolbar, and section loop. **Do not** alter the surrounding Stat band or anything below the legend.

```jsx
const CATS = [["All", "All items"], ["Warframe", "Warframe"], ["Weapon", "Weapon"], ["Set", "Full sets"], ["Mod", "Primed mods"], ["Arcane", "Arcanes"]];
const SORT_OPTS = [["Value ▾", "Value · high"], ["Value ▴", "Value · low"], ["Trend ▾", "Trend"], ["Name", "Name"]];

function Inventory({ items, onOpen }) {
  const [cat, setCat]   = useState("All");
  const [hot, setHot]   = useState(false);
  const [sort, setSort] = useState("Value ▾");
  const [q, setQ]       = useState("");
  const [view, setView] = useState(() => { try { return localStorage.getItem("wfit-inv-view") || "grid"; } catch (e) { return "grid"; } });
  React.useEffect(() => { try { localStorage.setItem("wfit-inv-view", view); } catch (e) {} }, [view]);

  const query = q.trim().toLowerCase();
  const match = (it) => {
    if (query && !(it.name + " " + it.part + " " + it.cat).toLowerCase().includes(query)) return false;
    if (hot && !it.hot) return false;
    return true;
  };
  const sorter = (a, b) =>
    sort === "Value ▾" ? b.plat - a.plat :
    sort === "Value ▴" ? a.plat - b.plat :
    sort === "Trend ▾" ? b.d - a.d :
    a.name.localeCompare(b.name) || a.part.localeCompare(b.part);

  return (
    <React.Fragment>
      <div className="filters">
        <div className="search" style={{ maxWidth: 300 }}>
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter parts… set:saryn, is:hot, plat>40" />
        </div>
        <button className="chip" aria-pressed={hot} onClick={() => setHot((h) => !h)}>▲ Hot</button>
        <Dropdown icon="filter" value={cat} options={CATS} onChange={setCat} align="left" title="Filter by category" />
        <div className="sp"></div>
        <span className="sortlbl">sort</span>
        <Dropdown icon="sort" value={sort} options={SORT_OPTS} onChange={setSort} align="right" title="Sort items" />
        <Dropdown value={view} options={VIEWS} onChange={setView} align="right" title="Layout" />
      </div>

      {SECTIONS.map((sec) => {
        if (cat !== "All" && cat !== sec.id) return null;
        const list = items.filter((it) => it.cat === sec.id && match(it)).sort(sorter);
        if (list.length === 0 && (hot || query)) return null;
        return <Section key={sec.id} sec={sec} items={list} onOpen={onOpen} view={view} />;
      })}

      <div className="legend">
        <span className="sw"><span className="box" style={{ background: "var(--t-exotic)" }}></span>≥120 p</span>
        <span className="sw"><span className="box" style={{ background: "var(--t-legend)" }}></span>45–119 p</span>
        <span className="sw"><span className="box" style={{ background: "var(--t-rare)" }}></span>15–44 p</span>
        <span className="sw"><span className="box" style={{ background: "var(--t-basic)" }}></span>&lt;15 p</span>
        {view === "grid"
          ? <span className="sw">▲ hot · bottom bar = 7d trend · ×n owned</span>
          : <span className="sw">▲ hot · color = value tier</span>}
      </div>
    </React.Fragment>);
}
```
> `SECTIONS` = your existing category list `[{ id, label, letter }]` (Warframe/Weapon/Set/Mod/Arcane). `CATS[i][0]` must equal the matching `SECTIONS` `id`. **Migration note:** the old build had a single `filter` state with `"All"/"Hot"/<category>` and a `FILTERS`/`SORTS` array — those are removed; replace with `cat` + `hot` above.

---

## 6. Icons to add

Add five 24×24 stroke glyphs to your icon set (`fill:none; stroke:currentColor`). Reference paths:
```jsx
grid:   <><rect x="3.5" y="3.5" width="7" height="7"/><rect x="13.5" y="3.5" width="7" height="7"/><rect x="3.5" y="13.5" width="7" height="7"/><rect x="13.5" y="13.5" width="7" height="7"/></>,
chips:  <><rect x="3" y="5" width="18" height="6" rx="1"/><rect x="3" y="13" width="18" height="6" rx="1"/></>,
rows:   <><path d="M4 6h16M4 12h16M4 18h16"/></>,
filter: <><path d="M4 5h16l-6 7v5l-4 2v-7z"/></>,
sort:   <><path d="M5 7h14M5 12h9M5 17h5"/></>,
```
(`grid`/`chips`/`rows` label the View options; `filter`/`sort` are the Category/Sort button icons.)

---

## 7. Tweaks wiring (prototype only — skip for production unless exposing as user settings)

The reference exposes Grid controls in a dev Tweaks panel by toggling `<body>` classes. Equivalent product surface = a small "view options" affordance. Mapping:
- **Tile size** → `body.dense` (Compact) / none (Default) / `body.tile-lg` (Large).
- **Labels** → none (All) / `body.labels-hi` (High value) / `body.labels-hover` (Hover).
- **Magnify on hover** → toggle `body.no-magnify` (present = OFF).

Defaults: Default size, All labels, Magnify ON — i.e. the dense baseline is unchanged unless opted into.

---

## 8. Porting notes (non-prototype codebases)
- **State:** the only persisted bit is `view` (`localStorage["wfit-inv-view"]`). `cat/hot/sort/q` are ephemeral local UI state. If you use a store/URL params, put them there instead — behavior unchanged.
- **`<body>` class toggles:** if global body classes are undesirable, scope the same selectors under the Inventory root element instead (`.inventory-root.tile-lg …`). The selectors are otherwise identical.
- **Dropdown a11y:** add `role="listbox"`/`option` + keyboard (↑/↓/Enter/Esc) if your bar requires it; the reference is mouse-only (outside-click close). Don't regress your existing a11y.
- **Icons in Chips/List:** swap the glyph placeholder for your real item-icon component at the box sizes noted; keep the tier color on the tile top-border (grid), chip left-border (chips), and glyph top-border (list).

## 9. Acceptance checklist
- [ ] Grid tiles: value label is `11px/700/#fff` on a `14px` dark bar; hovering a tile magnifies it (unless magnify disabled).
- [ ] Tile size has 3 steps (40 / 46 / 62) and the value label scales on Large.
- [ ] View dropdown switches Grid / Chips / List; choice **survives reload**.
- [ ] Chips show full item names with ellipsis (no collision with the price column).
- [ ] List is a `.dtable` with Item / 7d (spark+%) / Qty / Unit / Stack, right-aligned mono numbers.
- [ ] Section headers (collapse, count, stack value) and tier coloring are identical across all 3 views.
- [ ] Toolbar = search + `▲ Hot` toggle + Category + (spacer) + Sort + View; **all 30px tall**.
- [ ] Hot + Category combine (e.g. only-hot-warframe); right-side menus don't clip off-screen.
- [ ] No other screen, the drawer, modal, sidebar, stat band, data model, or global tokens changed.
```
