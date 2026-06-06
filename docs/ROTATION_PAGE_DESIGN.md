# Primely / WFIT — Visual Design Spec

> A reference for reproducing the **look** of the WFIT (Warframe Item Tracker) desktop UI in code.
> This is **not** a build/handoff doc — there are no install steps, data contracts, or component APIs here.
> It documents the *aesthetic*: the exact tokens, the rules, the textures, and the gotchas that make
> a screen read as "Primely" rather than generic dark dashboard #4,000.
>
> If you internalize one thing: **this is a dense, square, terminal-adjacent desktop app. Hairline
> borders do the work that whitespace and shadows do elsewhere. Monospace carries every number.**

---

## 1. The aesthetic in one paragraph

Primely looks like a **professional desktop trading terminal** wearing a game-tracker's data. It is
near-black, flat, and **gridded** — panels are separated by 1px hairlines, not gaps or drop shadows.
Information density is high and deliberate: a single screen carries 6–9 modules without feeling
cluttered because everything snaps to the same border system and the same tight type scale. Numbers
are **always monospaced and tabular** so columns of figures line up to the pixel. Color is spent
sparingly and only ever *means* something — a gold number is ducats, a blue number is platinum, a
green badge is "good deal." There is essentially **no border-radius**, **no gradient** (two sanctioned
exceptions), and **no decorative anything**. The vibe is Bloomberg Terminal × a Warframe relay screen.

**If a design decision is ever ambiguous, choose: smaller, squarer, flatter, denser, quieter.**

---

## 2. Hard rules (break these and it stops looking like Primely)

1. **Corners are square.** `border-radius` is `0` everywhere except: the active nav/tab pill (`4px`)
   and small circular status dots/LEDs (`border-radius: 50%`). Cards, panels, buttons, badges,
   inputs, progress bars, swatches — all sharp 90° corners.
2. **Separation is by 1px border, not shadow or gap.** `box-shadow` is effectively unused. Modules
   sit in a `gap: 10px` grid, but their *internal* divisions (rows, headers, footers) are always
   `border-top: 1px solid var(--line)`.
3. **Every number is monospace + tabular.** Counts, prices, timers, percentages, balances → `--mono`
   with `font-variant-numeric: tabular-nums` and a slight negative letter-spacing (`-.02em`).
   Body labels and item names are sans.
4. **Color is semantic, never decorative.** Don't tint a panel "to add interest." A color appears
   only because it encodes a currency, a status, a tier, or a verdict (see §4).
5. **Type is small and tight.** Base font-size is `12px`. Section/eyebrow labels run `9.5–11px`,
   UPPERCASE, with positive letter-spacing. The only large type is intentional hero numbers/titles.
6. **Uppercase + letter-spacing = a label. Sentence case = content.** Headers, eyebrows, badges,
   and status flags are UPPERCASE with `letter-spacing: .05–.14em`. Item names, descriptions, and
   values are normal case.
7. **Lowercase is a deliberate texture for game-states.** World-cycle states (`day`, `night`,
   `warm`, `cold`, `fass`, `vome`) and Duviri moods render `text-transform: lowercase` — a small
   stylistic tell. Don't "fix" them to Title Case.
8. **Fixed canvas.** Every screen is designed at exactly **1280 × 840** (the app window). Content
   must fit without vertical scroll inside `.content` — if a list is too long, cap its rows, don't
   let it overflow.

---

## 3. Color tokens (exact values)

All colors are flat hex, declared as CSS custom properties on `:root`. **Never hand-pick a color that
isn't here** — if you need a new accent, it almost certainly maps to an existing semantic token.

### Greys — the entire structural palette
```css
--bg:      #0c0d10;  /* app window background (behind panels) */
--bg-2:    #111216;  /* sidebar + top bar + chrome surfaces */
--panel:   #15171b;  /* default panel/card fill */
--panel-2: #1b1d22;  /* raised insets: buttons, glyph tiles, grade boxes */
--line:    #24262e;  /* hairline divider — internal row borders */
--line-2:  #31343d;  /* stronger hairline — panel outer borders, inputs */
--hover:   #1f2127;  /* row/item hover fill + active nav fill */
/* page backdrop behind the whole window: #0a0b0d (darker than --bg) */
/* titlebar: #08090b (darkest) */
```
There are **seven greys** between `#08090b` and `#1b1d22`, and they form a strict depth ladder:
titlebar (darkest) → window bg → chrome → panel → panel-2 (lightest surface). Borders are a parallel
ladder: `--line` (subtle, internal) → `--line-2` (defining, external). Use the right rung; do not
collapse them.

### Text greys
```css
--ink:   #e2e3e6;  /* primary text: names, values, headings (NOT pure white) */
--soft:  #989ba2;  /* secondary text: labels, locations, descriptions */
--faint: #62656d;  /* tertiary: meta, units, timestamps, inactive */
--accent:#cfd2d8;  /* rare brighter ink for emphasis */
/* pure #fff appears ONLY on the active tab label — nowhere else */
```
Three-tier text hierarchy, always. A row is typically: **ink** name + **faint** subtitle, with a
**soft** value. Primary text is `#e2e3e6`, *not* white — pure white is reserved exclusively for the
active tab so it pops as the single brightest thing on screen.

### Status / functional accents
```css
--blue: #3d7df0;  /* interactive: active tab border, focus, B-grade, "platinum-ish" UI */
--pos:  #5fc27e;  /* positive: "grab"/good-deal, online dot, S/A grades, success */
--neg:  #e0685c;  /* negative/urgent: countdown <90s, aggressor invasion bar */
--hot:  #f0a93e;  /* warning/attention: countdown <5min, "NEW", weekly tags, Steel Path */
```

### Tier accents (relic tiers + reused widely)
```css
--t-lith:  #8a8f98;  /* grey   */
--t-meso:  #6f9bd1;  /* blue   */
--t-neo:   #c9a84a;  /* gold   */
--t-axi:   #9a83e0;  /* purple — also Nightwave progress + "collector" verdict */
--t-req:   #d0685c;  /* red    — Requiem; also invasion aggressor */
--t-omnia: #e0883c;  /* orange — Steel Path Omnia */
```

### World-cycle accents (the 3px left-edge stripe on cycle cards)
```css
--c-day:#d6b748; --c-night:#5b90d8;        /* Cetus  */
--c-warm:#e0883c; --c-cold:#5b90d8;        /* Vallis */
--c-fass:#e0883c; --c-vome:#6f9bd1;        /* Cambion*/
--c-joy:#5fc27e; --c-anger:#d0685c; --c-envy:#6fb3a8;
--c-sorrow:#5b90d8; --c-fear:#9a83e0;      /* Duviri moods */
```

### Currency accents (vendors — each currency owns a color)
```css
--ducat:   #d6b748;  /* gold  — Baro ducats */
--plat:    #6fa8d8;  /* blue  — market platinum value */
--aya:     #6fb3c9;  /* cyan  — Varzia Aya */
--essence: #b08fd6;  /* purple— Teshin Steel Essence */
```
**Currency = color is a load-bearing convention.** A user scanning the vendor table identifies "what
am I spending" purely by hue. Gold is always ducats. Blue is always platinum/market. Keep it consistent.

### Translucent accent fills (the only place rgba is used)
Tinted backgrounds/borders are built as `rgba()` of an accent at very low alpha, layered on a panel:
```css
/* active tab */        background: rgba(61,125,240,.08);  border-color: var(--blue);
/* "hit" fissure card */ border-color: rgba(95,194,126,.45);
                         background: linear-gradient(180deg, rgba(95,194,126,.05), var(--panel));
/* badge borders */      border-color: rgba(95,194,126,.5);  /* green verdict, etc. */
```
Alpha stays **low** (`.05–.10` for fills, `.4–.5` for borders). These tints whisper; they never shout.

---

## 4. How color gets *used* (semantics)

| Meaning | Token | Where it shows |
|---|---|---|
| Good deal / grab it / success / online | `--pos` green | verdict badge, NEW tag border, sync dot, S·A grades |
| Money: platinum / market value | `--plat` / `--blue` | market price column, "flip" verdict |
| Money: ducats | `--ducat` gold | Baro ducat costs, ducat totals |
| Money: Aya / Essence | `--aya` / `--essence` | Varzia / Teshin cost columns |
| Urgent (seconds left) | `--neg` red | countdown ≤90s, invasion aggressor side |
| Attention (minutes left / new / weekly) | `--hot` orange | countdown ≤5min, NEW, STEEL PATH, weekly challenge tag |
| Collector / cosmetic / Nightwave | `--t-axi` purple | "cosmetic" verdict, Nightwave progress bar |
| Owned / inactive / done | `--faint` grey + `opacity: .46` | owned vendor rows are dimmed wholesale |

**Owned-state pattern:** an owned item row gets `opacity: .46` on the *entire row* — not a strikethrough,
not a grey swap. It visually recedes while staying legible. This is the single most reused "state" treatment.

---

## 5. Typography

```css
--sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--mono: ui-monospace, "SF Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace;
```
System fonts only — no web fonts, no Inter. The look comes from **scale and weight discipline**, not a
typeface. `-webkit-font-smoothing: antialiased` on the app root.

### The type scale (memorize the small end — that's where you'll live)
| Use | size / weight / treatment |
|---|---|
| Eyebrow / section label / table head | **9.5px** 700 UPPERCASE, `letter-spacing: .06–.09em`, `--faint` |
| Badge / tag / status flag | **9.5–11px** 700 UPPERCASE, `.04–.06em` |
| Panel header `h3` | **11px** 700 UPPERCASE, `.07em`, `--ink` |
| Meta / unit / timestamp | **10.5–11px**, `--mono`, `--faint` |
| Body / item name | **12–12.5px** 600, `--ink` |
| Subtitle / description | **10.5–11px** 400, `--faint` |
| Base (window default) | **12px** / line-height **1.35** |
| Tab / nav item | **12.5px** |
| Top-bar title | **14px** 700 |
| Cycle state word | **17px** 700 lowercase |
| Nightwave rank / inline stat | **19–22px** 700 mono |
| Hero mission title | **34px** 800, `letter-spacing: -.02em` |
| **Hero timer (the showpiece)** | **52px** 800 mono, `letter-spacing: -.05em`, `line-height: .9` |

### Number rule (restated because it matters)
Anything numeric → `.num`/`.mono` utility: `font-family: var(--mono); font-variant-numeric: tabular-nums;
letter-spacing: -.02em;`. Big mono numbers get *tighter* tracking (`-.03` to `-.05em`) so the showpiece
timer reads as one solid mechanical block.

### "Don't be afraid of big text"
The design is mostly tiny, which is exactly what makes the occasional **huge** element land. When a
screen has a single most-important answer (is Baro here? how long until this fissure ends?), express it
as a **34px title + 52px mono timer** hero. The contrast between the 10px eyebrow above it and the 52px
number is the entire point. Use this sparingly — one hero per screen, max.

---

## 6. Layout & spacing

### The window (every screen is this exact shell)
```
1280 × 840 fixed .win  (flex column, overflow hidden)
├─ titlebar    28px   #08090b   — app name (uppercase, tracked) + min/max/close
└─ body  (flex row)
   ├─ sidebar  178px  #111216   — add button, nav list, "quick read" box, settings
   └─ main  (flex column, fills)
      ├─ top bar         #111216 — screen title · search field · sync status · icon btns
      ├─ tab strip               — Overview · Fissures · Vendors (active = blue pill)
      └─ .content  flex:1, padding:14px 16px, overflow hidden  ← screens render here
```
Sidebar width token: `--nav: 178px`. The content area is the only thing that changes between screens.

### Spacing scale
Tight and consistent. The recurring values: **panel gap `10px`**, **panel padding `8–12px` h /
`6–9px` v**, **row padding `5–7px` v / `12px` h**, **content padding `14px 16px`**, **icon/label gap
`8–10px`**. There is no 4-or-8 "design system" abstraction — these literal pixel values *are* the system.
When in doubt: outer gaps `10px`, inner row padding `~6px × 12px`.

### Grid composition (how screens are built)
Screens are CSS grid/flex compositions of **panels** at `gap: 10px`. Columns are weighted with `fr`
units to balance height, e.g. the Vendors screen is `grid-template-columns: 1.5fr 1fr` (Baro table |
Varzia+Teshin stack). The guiding goal is **no dead space**: columns are tuned so their stacked panels
bottom out near the same line. A column that ends short of its neighbor is the #1 thing to fix — add a
row, change the `fr` weight, or move a module.

**Density target:** a populated screen shows 6–9 distinct modules. If it looks airy, it's wrong.

---

## 7. Component catalogue

Every component below is flat, square, hairline-bordered. CSS is given where the values are load-bearing.

### 7.1 Panel — the universal container
```css
.pnl     { border: 1px solid var(--line-2); background: var(--panel);
           display: flex; flex-direction: column; min-width: 0; }
.pnl-h   { display:flex; align-items:center; gap:8px; padding:8px 12px;
           border-bottom: 1px solid var(--line); }      /* header */
.pnl-h h3{ font-size:11px; font-weight:700; text-transform:uppercase;
           letter-spacing:.07em; color:var(--ink); }
.pnl-h .meta { margin-left:auto; font-family:var(--mono); font-size:10.5px;
               color:var(--faint); }                    /* right-aligned count/timer */
```
**Every** module is a `.pnl`: a header row (uppercase title + optional right-aligned mono meta), then
content rows divided by `border-top: 1px solid var(--line)`. The first row never doubles its top border.
A footer (`margin-top:auto` to pin it to the bottom) uses the stronger `--line-2` border to close the card.

### 7.2 List row
```css
.mrow { display:flex; align-items:center; gap:10px; padding:7px 12px;
        border-top:1px solid var(--line); }
```
Pattern inside: a `.col` (flex column) holding `.mn` (12.5px 600 ink name) + `.ms` (11px faint subtitle),
a `.sp` spacer (`flex:1`), then a right-aligned value/timer. This name+subtitle / spacer / value rhythm
is the backbone of ~70% of the UI.

### 7.3 Status dot / LED
`6–8px` circle, `border-radius:50%`, filled with a semantic color. Green = live/online/good. Often paired
with an uppercase label. The top-bar **sync dot** is green with a mono "2s" timestamp beside it.

### 7.4 Tab strip
```css
.tab    { font-size:12.5px; color:var(--soft); padding:5px 12px;
          border:1px solid transparent; border-radius:4px; }
.tab.on { color:#fff; border-color:var(--blue); background:rgba(61,125,240,.08);
          font-weight:600; }
```
The **only** `4px` radius in the app, and the **only** pure-white text. Inactive tabs are borderless soft-grey.

### 7.5 Nav item (sidebar)
`6px 12px` rows, `15px` stroked icon + `12.5px` label, optional right-aligned mono count. Active item:
`background:var(--hover)` + `border-left:2px solid var(--ink)` + ink text 600. The left-border-accent is
the active indicator (note: a left accent bar is *fine here* on nav — it's an AI-slop trope only when
used as decoration on content cards, which this design never does).

### 7.6 Icons
Inline `<svg viewBox="0 0 24 24">`, **stroked not filled**: `stroke:currentColor; fill:none;
stroke-width:1.7–1.8; stroke-linecap:round; stroke-linejoin:round`. Sizes: `13px` (chrome/buttons),
`15px` (nav/top bar). Feather-style single-path geometry. **No emoji anywhere.** Color inherits from
text context (usually `--soft`/`--faint`).

### 7.7 Cycle card
```css
.cyc { border:1px solid var(--line-2); background:var(--panel); padding:9px 13px;
       position:relative; overflow:hidden; }
.cyc::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px;
               background:var(--cc, var(--soft)); }   /* --cc set inline per cycle */
.cyc .state { font-size:17px; font-weight:700; line-height:1.1; text-transform:lowercase; }
.cyc .place { font-size:11.5px; color:var(--soft); }
.cyc .cd    { font-size:11.5px; color:var(--faint); }  /* live countdown */
```
A small card with a **3px left color stripe** (the cycle's state color, passed via `--cc` inline), the
lowercase state word large, location small, and a live countdown. Four of these in a row = the world-state strip.

### 7.8 Grade box (arbitration)
`20px` square, mono, bordered. A/S → green border+text, B → blue, C → soft, D/F/— → faint. A tiny
square "rating chip." This is how qualitative scores render: a bordered mono letter in a fixed square.

### 7.9 Tier chip
```css
.tchip { display:inline-flex; align-items:center; gap:6px; font-size:12px; }
.tchip .sq { width:9px; height:9px; }   /* SQUARE, not round — color = tier */
```
A **9px square** (never a circle) in the tier color + the tier name. The squareness vs. the round status
dots is intentional: squares categorize, circles indicate live status.

### 7.10 Progress bar
```css
height:6px; background:var(--bg); border:1px solid var(--line);   /* track */
i { height:100%; background:var(--t-axi); }                       /* fill, square */
```
Thin, square, bordered track with a flat color fill. No radius, no gradient, no animation. Used for
Nightwave standing and invasion tug-of-war (the invasion bar is two-sided: `--t-req` from left,
`--blue` from right, meeting at the contested point).

### 7.11 Badge / tag / verdict
Small uppercase mono-ish label, `1px` border in a low-alpha accent, `2px 7px` padding, square. Examples:
`NEW` (green), `STEEL PATH` (orange), weekly challenge `tag` (orange), vendor `verdict` (Grab=green,
Flip=blue, Cosmetic=purple, Owned=faint). The border carries the color at `.4–.5` alpha; the text is the
solid accent.

### 7.12 The hero (showpiece module)
The big-moment component (fissure-watch in Overview B, Baro arrival in Vendors). Structure:
```
.fwx-top    — eyebrow row: LED + uppercase label + dim sublabel + right-aligned status ("● ACTIVE NOW")
.fwx-main   — flex space-between: { 34px/800 title + meta row } | { 52px/800 mono timer + tiny label }
.fwx-counts — flex row of 4 stat cells, divided by --line borders: big mono value + tiny uppercase key
```
The "active/hit" state tints the whole card: `border-color: rgba(95,194,126,.45)` +
`linear-gradient(180deg, rgba(95,194,126,.05), var(--panel))`. This is the green "good news" glow — one
of only two sanctioned gradients (the other being the rarely-used `.hero` 110° panel sheen). Everywhere
else: flat fills only.

### 7.13 Data table (vendor stock)
A CSS-grid table (not `<table>`): a `.vt-head` header row of uppercase faint labels, then `.vrow` grid
rows sharing one `grid-template-columns` template (e.g. `26px 1fr 64px 70px 58px 74px`). Columns: glyph
tile · name+type · ducats(gold) · credits(soft) · market(blue) · verdict badge. Numeric columns are
right-aligned mono. Rows hover to `--hover`; owned rows dim to `.46`. A pinned footer totals the column.
The glyph tile (`.vgl`) is a `26px` square with the item's initials in mono and a `2px` top-border in the
verdict color — a poor-man's icon that stays on-brand (no fake imagery).

---

## 8. Motion & interactivity

- **Live countdowns** are the only constant motion: a single 1s interval re-renders all timers. Format
  is Warframe-style — `1d 14h 22m`, `2h 05m 41s`, `41m 12s` (drops the largest empty unit). As a timer
  crosses thresholds it **recolors**: default ink → `--hot` orange at ≤5min (`warn`) → `--neg` red at
  ≤90s (`soon`). Hero/vendor timers use larger thresholds (hours).
- **Hover** is a quiet `background: var(--hover)` swap on rows/items. No transforms, no lift, no glow.
- **No entrance animations, no decorative loops, no parallax.** The app is calm; only the numbers tick.

---

## 9. Anti-patterns — things that will make it look *wrong*

- ❌ Rounded corners on cards/buttons/badges (only the active tab gets `4px`).
- ❌ Drop shadows / elevation to separate things (use 1px borders).
- ❌ Gradients for "interest" (only the two sanctioned ones in §7.12).
- ❌ Proportional/inconsistent number fonts, or numbers in sans (always mono + tabular).
- ❌ Pure white body text (that's `--ink #e2e3e6`; white is the active tab only).
- ❌ Emoji, filled icons, or SVG-drawn illustrations/mascots.
- ❌ Decorative colored panels or left-accent-bar content cards (the AI-slop tell).
- ❌ Airy, low-density layouts with big empty gaps. Dead column-bottoms = a bug.
- ❌ Sentence-case headers or Title-Case cycle states. Headers UPPERCASE+tracked; states lowercase.
- ❌ Inventing a color. If you reach for a hue, find its semantic token in §3 first.
- ❌ Spacing that drifts off the §6 scale (10 / 12 / 6–8). No random 16/20/24 paddings inside panels.

---

## 10. Copy / tone

Terse, knowledgeable, slightly insider. Labels are short ("Up Next", "Fissure Watch", "Quick read",
"Clear unowned"). Status reads like a HUD ("● ACTIVE NOW", "HERE NOW", "away"). Verdicts are one word
("Grab", "Flip", "Cosmetic", "Owned"). Uses Warframe domain vocabulary without explaining it (the user
is an expert). Numbers speak for themselves — annotate with a faint unit (`p`, `Aya`, mono) rather than
a sentence.

---

## 11. Quick-start checklist for a new screen

1. Drop the **1280×840 window shell** (titlebar / sidebar / top bar / tabs / `.content`).
2. Decide the **one** most important answer → make it a **hero** (34px title + 52px mono timer) at top,
   full-width, with the green "hit" tint if it's good news.
3. Lay the rest as a **`gap:10px` grid of `.pnl` panels**, weighted with `fr` so columns bottom out even.
4. Inside each panel: uppercase `h3` header + mono `meta`, then hairline-divided rows (name/subtitle /
   spacer / mono value). Pin a `--line-2` footer if there's a total.
5. **Numbers mono+tabular. Colors only where they mean something. Corners square. Density high.**
6. Sanity check against §2 and §9. If anything is round, soft, gradient-y, airy, or white — fix it.
