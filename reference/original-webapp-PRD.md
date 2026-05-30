# PRD — Warframe Inventory Pricer

**A polished, keyboard-first web app that tracks your Warframe prime-part inventory and shows which parts are worth the most platinum on warframe.market. Magic-link sign-in; data syncs across all your devices.**

Document owner: Finn
Status: Active build — Phase A (foundation) — webapp + Supabase
Intended executor: Claude Code

Companion documents:
- `current-scope.md` — live state, decisions log, what's been ruled out.
- `warframe-inventory-research-findings.md` — reference landscape (warframe.market, WFCD/warframe-items, historical auth research).
- `phase0/findings.md` — full evidence trail from the auth-spike investigation that led to this product shape.

---

## 0. Pivot history

**Pivot 1 (2026-05-29 morning):** dropped DE auth. Phase 0 closed RED on every auto-sync path — Akamai bot manager hard-blocks `mobile.warframe.com/api/login.php` for all non-game-client traffic (tested across urllib, Chrome/Firefox/Safari/Edge TLS impersonation via curl-cffi, Playwright `context.request`, and Playwright in-page `fetch()` from the correct origin). Sainan-style process-memory extraction (the only known working third-party architecture) is Windows-only and a Linux/Proton port is an unscoped reverse-engineering effort. Product became a polished manual-entry tool.

**Pivot 2 (2026-05-29 evening):** dropped Tauri. After the Tauri scaffold landed and hit the standard one-time `webkit2gtk-4.1` system-dep install on Linux, Finn called the architectural question: webapp would be lower friction (zero install, cross-device, shareable) and is a better fit for how he wants to use the tool — including on his phone and laptop both. Product became a webapp with Supabase backend.

**Current shape:** a static React SPA hosted as a webapp; Supabase provides Postgres (with RLS for per-user inventory), magic-link auth, and an edge function that proxies warframe.market (the API doesn't send CORS headers, so a browser cannot call it directly). Data syncs across devices via the user account.

---

## 1. Summary

Players accumulate hundreds of tradeable prime parts and have no quick way to see which are worth the most platinum on the open market. AlecaFrame solves this on Windows via Overwolf but doesn't run on Linux. This tool fills that gap with a deliberately simpler approach: **you maintain your inventory in a webapp, we price it.**

The product:
1. Magic-link sign-in (no password — one click from your email).
2. Add owned prime parts via a fast Cmd/Ctrl+K command palette.
3. Inventory + sales sync across all your devices via Supabase Postgres (with row-level security so only you see your data).
4. Prices each item against the **median** of warframe.market's live statistics (via an edge-function proxy that handles the CORS gap).
5. Presents a ranked, sortable overview with totals (plat, ducats, full sets, prime parts).
6. Tracks every sale you log, with rollups (today / week / month / all-time) and a sparkline.
7. Detects complete sets and hints when selling-as-set beats selling-as-parts.

It is an **out-of-game tool** used between play sessions to decide what to sell next. Open it on desktop, phone, work computer — same inventory, same sales, anywhere.

## 2. Goals and non-goals

### Goals
- Add a new prime part in **under 3 seconds**: Cmd/Ctrl+K → type 2-3 letters → Enter.
- Mark an item sold in **one keystroke** (`S` on the focused row); decrement, log, undo-toast.
- Show total inventory plat value, prime-part count, full-set count, and total ducats at a glance.
- Rank every owned tradeable prime part by plat value descending by default.
- Track sales over time: full history, plat-earned rollups, top sales, sparkline.
- Detect complete sets and surface "sell as set vs sell as parts" when it matters.
- Persist everything locally; survive restarts; back up to JSON.
- Linear/Raycast-level polish: dark theme by default, dense layout, keyboard-first, only confirmatory animations.

### Non-goals (v1)
- **No Warframe account authentication.** The app cannot see your Warframe / Steam / DE account. The only sign-in is the wfinv magic-link (email-only) for syncing your *own* inventory across devices.
- No automated trading, listing creation, or any write action against any game account or marketplace.
- No mods, rivens, arcanes, or relic pricing — prime parts and sets only.
- No multi-Warframe-account support (one wfinv account = one inventory).
- No in-game overlay or live-while-playing display.
- No OCR / screen capture.

## 3. Target user

Finn — solo player on Linux (CachyOS/KDE) primary and macOS. Trades prime parts. Wants a fast, clean read on inventory value. Design-conscious; prefers minimal, polished, lightweight software over feature bloat. Keyboard-first; comfortable with shortcuts.

## 4. Stack

**Frontend:** React + TypeScript + Vite + Tailwind, hosted as a static SPA on Cloudflare Pages / Vercel / Netlify.
**Backend:** Supabase (Postgres + auth + edge functions).

Rationale:
- Zero install for the user; works anywhere with a browser (desktop, phone, Steam Deck, work computer).
- Single React codebase; same app on every device. Inventory + sales sync automatically.
- Supabase free tier covers a personal/hobby project comfortably (500 MB Postgres, 50 k MAU).
- Supabase Auth provides magic-link email sign-in with zero ceremony — no password to remember, no signup form.
- Supabase Postgres + RLS (row-level security) is the right shape for per-user data isolation.
- Edge function bridges the CORS gap to warframe.market (their API has no `Access-Control-Allow-Origin`).
- UX libs: Radix UI for accessible primitives; `cmdk` for the command palette; TanStack Query for query/mutation state; `react-virtual` for the list; `recharts` for the sparkline.

## 5. Architecture

```
┌──────────────────────────────────────────────────┐
│ React SPA (static; Cloudflare Pages/Vercel)       │
│  - SignIn (magic-link email)                      │
│  - Inventory (palette, list, summary)             │
│  - Sales (rollups, sparkline, history)            │
│  - Settings (catalog refresh, sign out)           │
└────────┬─────────────────────────┬───────────────┘
         │ supabase-js              │ supabase.functions.invoke()
         │ (auth + queries + RLS)   │
         ▼                          ▼
┌──────────────────────┐  ┌────────────────────────┐
│ Supabase Auth        │  │ Edge Function:         │
│   - magic-link email │  │   market-proxy         │
└──────────────────────┘  │   (Deno)               │
                          │   - throttled 3 req/s  │
┌──────────────────────┐  │   - writes to Postgres │
│ Supabase Postgres    │◀─┤     via service role   │
│   - catalog_items    │  └─────────┬──────────────┘
│   - price_cache      │            │
│   - inventory_items  │            ▼
│     [RLS: per user]  │      warframe.market v1
│   - sale_events      │      api.warframe.market
│     [RLS: per user]  │
│   - RPCs:            │
│       add_to_inv,    │
│       record_sale,   │
│       inv_summary    │
└──────────────────────┘
```

Per-user data (`inventory_items`, `sale_events`) is protected by RLS policies (`auth.uid() = user_id`); shared data (`catalog_items`, `price_cache`) is readable by any authenticated user. The frontend talks directly to Postgres via `supabase-js`; writes from the warframe.market proxy happen with the service-role key inside the edge function.

## 6. Data pipeline (the core logic)

1. **Catalog.** Manual or weekly trigger calls the `market-proxy` edge function with `action: "catalog_refresh"`. Function fetches warframe.market `/items`, derives `part_type` and `set_slug` heuristics, upserts into `catalog_items` (shared across all users). WFCD/warframe-items metadata enrichment for ducats, vaulted, and set parts can be layered on top in a later iteration.
2. **Inventory entry.** Cmd/Ctrl+K opens the palette; user searches `catalog_items` and presses Enter. Frontend calls `add_to_inventory(p_slug, p_qty)` RPC, which upserts under the current `auth.uid()`. RLS ensures this only ever affects the signed-in user's row.
3. **Price.** Frontend triggers `market-proxy` with `action: "prices_refresh"`. Function fetches `/items/<slug>/statistics`, computes 90-day median + 7-day trend, upserts into shared `price_cache` with a 6h TTL. Throttled to ~3 req/s inside the function.
4. **Aggregate.** `inventory_summary()` RPC: a single Postgres query joins `inventory_items` × `catalog_items` × `price_cache`, computes total plat, prime-part count, full-set count (via CTE comparing owned-parts to total-parts per set), and total ducats — all server-side, one round-trip.
5. **Rank.** Frontend SELECTs `inventory_items` joined with `catalog_items` + `price_cache`, ordered by `median_plat * qty` desc by default. Sort/filter clauses applied client-side over the (typically <1000 rows) result.
6. **Sales.** Quick `S` → `record_sale(p_slug, p_qty=1)` RPC: atomic in Postgres — writes `sale_events` row (snapshotting current `median_plat`), decrements `inventory_items.qty`, deletes the row if qty hits 0, all in one transaction.

## 7. Data model (Supabase Postgres)

See `supabase/migrations/0001_init.sql` for the authoritative schema. Summary:

```
catalog_items (shared)
  slug PK | display_name | part_type | set_slug -> catalog_items
  ducats | is_vaulted | is_tradeable | thumbnail_url | updated_at

price_cache (shared)
  slug PK -> catalog_items | median_plat | trend ('up'|'flat'|'down')
  fetched_at | expires_at

inventory_items (per user, RLS: auth.uid() = user_id)
  user_id PK -> auth.users | slug PK -> catalog_items
  qty | first_added_at | last_modified_at | notes

sale_events (per user, RLS: auth.uid() = user_id)
  id PK | user_id -> auth.users | slug -> catalog_items
  qty | plat_per_unit | market_median_at_sale_time
  sold_at | notes
```

RPCs: `add_to_inventory(p_slug, p_qty=1)`, `record_sale(p_slug, p_qty, p_plat_per_unit?, p_notes?)`, `inventory_summary()`.

Data location: Supabase-hosted Postgres in the project's region. The user's data exists only inside their own RLS-protected rows.

## 8. Hard constraints

- **C1 — warframe.market rate limits.** ~3 req/s. Throttled inside the edge function; never re-price on every UI render.
- **C2 — Price freshness.** Prices move and vault state changes. Always show `last_synced`; never present a cached price as live without surfacing its age.
- **C3 — Per-user data isolation.** Every per-user table (`inventory_items`, `sale_events`) has RLS policies enforcing `auth.uid() = user_id`. A bug that bypasses RLS is a critical bug.
- **C4 — Catalog/price shared safely.** `catalog_items` and `price_cache` are public-read for authenticated users and only writeable by the edge function (service role). No frontend writes to either table.
- **C5 — No Warframe-account credentials, ever.** The app sends HTTP only to: Supabase (the user's own backend) and warframe.market (via the proxy). Never to DE / Steam / mobile.warframe.com / etc.
- **C6 — Keyboard-first.** Every common task must be reachable from the keyboard. Mouse-only flows are bugs.

## 9. Notes on what was tried (preserved from Phase 0)

The original PRD assumed direct authentication to DE's account servers. Phase 0 investigated this exhaustively:

| Path | Outcome |
|---|---|
| Steam OpenID → warframe.com session → inventory | Auth works; resulting session is for the website, which has no inventory feature. |
| DE email/password (cephalon-sofis 2015 protocol) | `api.warframe.com/API/PHP/*` host fully decommissioned; every path 404s. |
| DE email/password (current Sainan/SpaceNinjaServer endpoint) | `mobile.warframe.com/api/login.php` blocked by Akamai bot manager for all non-game-client traffic. |
| Browser TLS impersonation (curl-cffi: Chrome/Firefox/Safari/Edge) | Akamai 403 on every profile. |
| Real Playwright Chromium with in-page `fetch()` | Akamai 403; sensor cookies never even issued. |
| Sainan-style process-memory extraction | Confirmed working on Windows; Linux/Proton port is a real reverse-engineering project — out of scope for this build. |

Conclusion documented in `phase0/findings.md`. The pivot to manual entry is what makes this product shippable on Linux in 2026.

## 10. Milestones

### Phase A — Foundation (in progress; ~1-2 more days)
- Vite + React + TS + Tailwind scaffolded. ✓
- Supabase migrations (schema + RPCs + RLS policies). ✓ (apply via dashboard once project exists)
- Edge function: `market-proxy` (catalog refresh + prices refresh). ✓ (deploy via Supabase CLI)
- supabase-js client + typed Database interface. ✓
- Magic-link auth (`AuthProvider`, `SignIn` route). ✓
- Auth-gated shell with three tabs (Inventory / Sales / Settings). ✓
- Settings tab: catalog count, refresh catalog, refresh prices, sign out — all wired to real backend calls. ✓
- **Remaining:** Finn creates a Supabase project, runs `0001_init.sql`, deploys the edge function, fills `.env.local`.

**Exit:** `npm run dev` boots the app; magic-link email arrives in your inbox and signs you in; Settings → Refresh catalog populates `catalog_items` with ~3000 rows; the count refreshes in the UI.

### Phase B — Core UX (~4-5 days, the most important phase)
- Command palette (Cmd/Ctrl+K) — fuzzy search, thumbnails, current plat in each row, Enter-to-add (stays open for batch).
- Inventory view — 4 summary cards (Total plat hero, prime parts, full sets, total ducats), sort/filter chips, virtualized ranked list.
- Quick-sold (`S`) with bottom undo toast (5s window).
- Sold-with-details (`Shift+S`) inline form: qty + plat-each.
- Inline qty edit (click chip or `+`/`-` on focused row).
- Full keyboard navigation: arrows, `S`, `+`/`-`, `Esc`, `Enter`, `Cmd/Ctrl+1/2/3`.
- Dark-theme polish: Inter for UI, JetBrains Mono for numbers, tabular numerals, 40px row height, 24px thumbs.
- Confirmatory micro-animations only: qty pulse, summary tween, palette fade.

**Exit:** with empty inventory, you add 40 items in under 5 minutes using only the keyboard. Selling and undo feels instant. Summary cards tween smoothly.

### Phase C — Earnings + set features (~3 days)
- Sales view: hero rollup (Today / Week / Month / All-time), 60-day sparkline, top-sales card, paginated history list with edit/delete.
- Set detection: "Complete set" badge on parts when all components are owned.
- "View as sets" toggle: collapses parts into their set row.
- "Sell as set vs parts" inline hint when set median > sum of parts.
- Bulk paste import (`Cmd/Ctrl+Shift+V`): textarea with live-preview matched/unmatched table.
- Manual catalog refresh and price refresh buttons in Settings.

**Exit:** a week of trading is captured accurately. "How much did I earn this month?" is a 2-click question. Set hint actually changes a buying/selling decision.

### Phase D — Distribution + light theme (~1-2 days)
- Light theme with "follow system" option.
- JSON backup/restore: roundtrip inventory + sales perfectly.
- Deploy to Cloudflare Pages (or Vercel) via Git push.
- Add the production domain to Supabase auth's allowed redirect URLs.
- Configure custom domain if desired (optional).
- Optional: PWA manifest + service worker so the site can "install to home screen" for a native-ish window.
- Settings view: theme picker, manual refresh, backup, about pane.

**Exit:** the site lives at a public URL; signing in from your phone works; data syncs across devices in real time.

## 11. Acceptance criteria (v1)

- Magic-link sign-in works from a fresh browser; the email arrives within 30s.
- Adding 40 prime parts from empty takes under 5 minutes using only the keyboard.
- Prime parts are ranked by per-item plat value desc by default; totals are arithmetically correct.
- Prices visible in the UI are recognizably consistent with warframe.market at sync time; `last_synced` is always shown somewhere.
- No write action is ever sent to any Warframe / Steam / DE endpoint.
- Network calls from the browser are only: Supabase (REST + functions) and Supabase Auth — verifiable from DevTools.
- A second device signing in with the same email sees the same inventory + sales within seconds.
- Inventory and sales survive sign-out + sign-in and database-side wipes only happen if the user explicitly requests them.
- JSON export + import roundtrips inventory + sales without loss.
- Visually matches the dense, Linear-style approved aesthetic in dark mode.

## 12. Open product decisions (revisit during build)

- Catalog source priority: warframe.market for slugs/catalog, WFCD/warframe-items for ducats + set parts + vaulted. Confirm in Phase A by inspecting both API responses.
- "Recently emptied" items at qty=0: stay forever (default) or auto-clear after N days (Settings toggle).
- Accent color: default cyan (`~#22d3ee`); Settings option for cyan / orange / magenta / neutral.
- "View as sets" toggle persistence: per-app default (not per-session). Reconsider after using it.
- Should bulk-paste import also support pasting from screenshots via clipboard image OCR later? Out of v1.

## 13. References

**Load-bearing for implementation:**
- warframe.market API docs: `warframe.market/api_docs` (v1) — catalog (`/items`), pricing (`/items/<slug>/statistics`).
- Item metadata: `github.com/WFCD/warframe-items` — ducats, vaulted, set part relationships, thumbnails.
- DE Public Export: Warframe Wiki "Public Export" — fresh ducat values and item manifest.
- Supabase docs: `supabase.com/docs` (auth, RLS, edge functions, supabase-js).
- cmdk command palette: `github.com/pacocoursey/cmdk`
- Radix UI primitives: `radix-ui.com`
- TanStack Query: `tanstack.com/query`

**Project-local:**
- `supabase/migrations/0001_init.sql` — schema + RLS + RPCs.
- `supabase/functions/market-proxy/index.ts` — warframe.market CORS proxy + cache writer.
- `supabase/README.md` — one-time setup steps.

**Historical context (resolved, kept for archaeology):**
- `phase0/findings.md` — full evidence trail of why direct DE auth was abandoned.
- `_archive-src-tauri/` — Tauri/Rust scaffold from Pivot 1 → Pivot 2. Not active; preserved in case the desktop shape is revisited.
- `Sainan/warframe-api-helper` (Aug 2025) — the Windows tool that proved memory-extraction is the only viable third-party path to DE inventory; out of scope.
- `spaceninjaserver/SpaceNinjaServer` — DE web-services reimplementation, useful as a protocol spec if anyone ever revisits the auth path.
