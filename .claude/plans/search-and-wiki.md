# Plan — Supercharged search + in-app wiki

## Context
Two requested features for WFIT:
1. A **DIM-style global search** in the top bar: search all tradable items (not just
   inventory), with an `ininv:` prefix to scope to what you own. Clicking any result —
   owned or not — opens the existing item **drawer** (price history, candles, stats).
2. An **in-app wiki**: a button on the drawer that opens the item's warframe.com wiki page.

### Locked decisions (confirmed with user)
- **Wiki = dedicated in-app Tauri WebviewWindow** (a second in-app window), NOT an iframe and
  NOT embedded in the drawer. Reason: `wiki.warframe.com` returns `X-Frame-Options: DENY` +
  CSP `frame-ancestors 'none'`, and Fandom returns `SAMEORIGIN` + Cloudflare challenge — iframes
  are impossible. Embedding a native webview inside the (scrolling, resizable) drawer needs
  Tauri's unstable multi-webview with known positioning bugs, so it was rejected.
- **Search scope = tradable warframe.market catalog only** (~3,800 items). Non-tradable items
  aren't in our data, so the "non-tradable → straight to wiki" path is moot; the Wiki button is
  simply always available on the drawer.

## Feature 1 — Global search (command-palette dropdown)

Backend already has everything: `search_catalog(q, limit)` (`commands.rs:71`, `db/catalog.rs`)
returns `CatalogRow[]` with `owned_qty`, `on_watchlist`, `buy_qty`, `median_plat`,
`thumbnail_url`. The `searchCatalog` wrapper exists in `src/lib/api.ts` but is unused.

- **`useSearchCatalog(q)`** hook in `src/hooks/queries.ts` (React Query, keyed on the query,
  `enabled` when q is non-empty).
- **`SearchResults` dropdown** (`src/components/SearchResults.tsx`): renders under the top-bar
  input; each row = `Glyph` (real icon) + name + part_type + price + owned/watch chips. Click →
  `onOpen(slug)` (opens the drawer, which already works for any catalog slug — confirmed
  `get_item_detail` serves non-owned items), then clears the search.
- **`ininv:` prefix**: strip it from the query and filter results to `owned_qty > 0`
  (results already carry `owned_qty`). Keep parsing simple/extensible for future prefixes.
- **Wiring** in `src/App.tsx`: the top-bar search already holds `search`/`deferredSearch`; render
  the dropdown when the (deferred) query is non-empty, over all screens. Esc closes; optional
  ↑/↓ + Enter selection. The Inventory grid's existing local filter can stay (harmless).
- **CSS**: dropdown panel styles in `theme.css` (`.search-results`, rows reuse `.gl`/chip styles).

Files: `src/App.tsx`, new `src/components/SearchResults.tsx`, `src/hooks/queries.ts`,
`src/theme.css` (`src/lib/api.ts::searchCatalog` already present).

## Feature 2 — In-app wiki window

- **`src/lib/wiki.ts`**:
  - `wikiUrl(item)` → `https://wiki.warframe.com/w/<Page>` where `<Page>` is the base item name
    (strip part suffixes like " Set"/" Blueprint"/"Neuroptics"… to the set/base name; spaces →
    underscores). Best-effort; falls back to the wiki search URL
    (`/w/Special:Search?search=<name>`) so it always lands somewhere useful.
  - `openWiki(item)` → opens/reuses a single in-app window via
    `@tauri-apps/api/webviewWindow` `WebviewWindow` (label `"wiki"`; if it exists, navigate +
    focus, else create with `{ url, title }`). Loading an external URL is a top-level navigation,
    so `X-Frame-Options` does not apply.
- **Drawer**: add a **"Wiki"** button (header or actions row) → `openWiki(item)`
  (`src/components/Drawer.tsx`). Available for every item.
- **Capabilities** (`src-tauri/capabilities/default.json`): add the ACL permission(s) for runtime
  webview-window creation/navigation (e.g. `core:webview:allow-create-webview-window`, plus
  window show/close/set-focus as needed — exact keys verified against Tauri 2 during impl). CSP is
  already `null`, so the external page loads.

Files: new `src/lib/wiki.ts`, `src/components/Drawer.tsx`, `src-tauri/capabilities/default.json`.

## Risks / notes
- **Tauri webview-window ACL**: getting the exact capability keys right is the main unknown;
  verify the window actually opens before building the rest of feature 2.
- **Wiki page mapping** is heuristic — some items may land on the wiki's search page rather than
  the exact article. Acceptable; refine names case-by-case later.
- One shared wiki window (reused/navigated), not a new window per click.

## Verification
- Search: type in the top bar → dropdown of catalog matches with icons/prices; `ininv: loki`
  scopes to owned; click a non-owned result → drawer opens with real price history.
- Wiki: open any item → click **Wiki** → an in-app window opens to that item's wiki page; clicking
  another item's Wiki reuses/navigates the same window.
- Gates: `cargo check`, `tsc --noEmit`, `npm run build`, Biome; then `scripts/install.sh` and a
  manual click-through.
