# wfinv — Project Handoff

A polished web app that tracks your Warframe prime-part inventory and prices it via warframe.market. Magic-link or Google sign-in; data syncs across devices.

This document is the **single entry point** for anyone (Finn returning to it later, a new contributor, or a fresh AI session) picking up wfinv. It captures the live state, the story of how it got there, what's been ruled out, and where to dig deeper.

---

## TL;DR

- **What:** webapp for Warframe traders to track owned prime parts and see what they're worth on warframe.market.
- **Stack:** React + TypeScript + Vite + Tailwind frontend → static site. Supabase Postgres + Auth + Edge Functions backend.
- **Status:** Phase A scaffold + Phase B core UX (Dashboard + Inventory + autofill) **shipped to local dev**. Sales view, Graph view, and warframe.market listings sync are next.
- **Live URL:** none yet (running locally via `npm run dev` → http://localhost:5173). Phase D ships to Cloudflare Pages / Vercel.
- **Repo:** https://github.com/finneritter/wfinv (private).
- **Supabase project:** `mpgcusphzngmvyscdiky` ([dashboard](https://supabase.com/dashboard/project/mpgcusphzngmvyscdiky)).

---

## How to run this locally (5 min on a clean machine)

Prereqs: Node 20+, the Supabase CLI installed (`~/.local/bin/supabase` on Finn's box).

```sh
git clone git@github.com:finneritter/wfinv.git
cd wfinv
npm install

# .env.local already pulled? If not, ask Finn — it has the anon key.
cp .env.example .env.local
# Edit .env.local with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
# (Supabase dashboard → Project Settings → API)

npm run dev
# → http://localhost:5173
```

If you're setting up a *new* Supabase project from scratch (not Finn's existing one), see `supabase/README.md` for the full setup (migrations, function deploy, auth provider config).

Optional: install `gh` and `supabase` CLIs if you'll be deploying. Both are already installed on Finn's CachyOS box at `/usr/bin/gh` and `~/.local/bin/supabase`.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│ React SPA (Vite, hosted as static site)           │
│  • SignIn       — magic-link email + Google OAuth │
│  • Dashboard    — summary cards + top items       │
│  • Inventory    — autofill search + ranked list   │
│  • Sales        — (placeholder, B4)               │
│  • Graph        — (placeholder, B5)               │
│  • Settings     — catalog/prices refresh, account │
└──────────┬─────────────────────────┬─────────────┘
           │ supabase-js              │ functions.invoke
           ▼                          ▼
┌──────────────────────┐  ┌────────────────────────┐
│ Supabase Auth        │  │ Edge Function:         │
│  • magic-link        │  │  market-proxy (Deno)   │
│  • Google OAuth      │  │  • /v2/items catalog   │
└──────────────────────┘  │  • /v1/stats prices    │
                          │  • throttled 3 req/s   │
┌──────────────────────┐  │  • writes via service  │
│ Postgres + RLS       │◀─┤    role               │
│  • catalog_items     │  └─────────┬──────────────┘
│  • price_cache       │            │
│  • inventory_items   │            ▼
│    [per user]        │     api.warframe.market
│  • sale_events       │      (v1 + v2)
│    [per user]        │
│  • RPCs:             │
│      add_to_inv      │
│      record_sale     │
│      inv_summary     │
└──────────────────────┘
```

**Per-user data isolation:** `inventory_items` and `sale_events` are RLS-protected (`auth.uid() = user_id`). Two users on the same Supabase project never see each other's inventory or sales.

**Shared data:** `catalog_items` and `price_cache` are public-read for any authenticated user. Only the edge function (service role) writes to them.

**Why a backend at all (for what's essentially a local tracker):** warframe.market's API has no CORS headers, so a browser cannot call it directly. Once we need a CORS proxy anyway, leaning on Supabase for auth and per-user data sync was nearly free.

---

## Story of how we got here (pivot history)

The original PRD scoped a polished cross-platform desktop app that authenticates directly to Digital Extremes' (DE) account servers and pulls inventory live. Two pivots got us to today.

### Pivot 1 — drop DE auth, manual entry (2026-05-29 morning)

**Why:** Phase 0 ran exhaustively. Steam OpenID and DE email/password were both tested.

- Steam OpenID → warframe.com session works fine, but the website doesn't expose inventory — it's a marketing/account-management surface.
- DE email/password on the historical `api.warframe.com/API/PHP/login.php` (the 2015-era `cephalon-sofis/warframe_api` reference) → host fully decommissioned, every path 404s.
- DE email/password on the current `mobile.warframe.com/api/login.php` (per the Aug 2025 `Sainan/warframe-api-helper` reference) → blocked by Akamai bot manager. Tested with urllib, curl-cffi Chrome/Firefox/Safari/Edge TLS impersonation, Playwright `context.request`, and Playwright in-page `fetch()` from the correct origin with all browser cookies. Akamai doesn't even issue sensor cookies; the endpoint is whitelisted for the game client only.
- Sainan-style process-memory extraction (the only known working third-party path in 2026) is Windows-only and would be a significant unscoped reverse-engineering project on Linux/Proton.

Full evidence trail in `phase0/findings.md`. The product pivoted to manual entry with a polished UX.

### Pivot 2 — drop Tauri, go webapp (2026-05-29 evening)

**Why:** Phase A scaffold (Tauri 2 + Rust core + React frontend) compiled cleanly, but hit the standard one-time `webkit2gtk-4.1` system-dep install on Linux. Finn called the architectural question: webapp would be lower friction (zero install, cross-device sync via phone/desktop, shareable URL) and better fit how he wants to use the tool.

Tauri Rust core archived at `_archive-src-tauri/` (preserved in case it's ever revisited). React frontend kept and reused.

### Current shape

Static React SPA + Supabase backend. Magic-link or Google sign-in. Per-user Postgres data. CORS proxy via edge function. No Warframe-account credentials, ever.

---

## What's done

### Phase A — Foundation ✓

- Vite + React + TS + Tailwind scaffold.
- supabase-js client + hand-typed `Database` interface (`src/lib/database.types.ts`).
- Magic-link auth provider + sign-in route.
- Three-tab shell (later expanded).
- Settings tab with catalog/prices refresh hooks.
- Supabase migrations (schema + RLS + RPCs) + market-proxy edge function.

### Phase B1 — Shell overhaul ✓

- Left sidebar nav (220px wide) replacing the topbar.
- Five routes: Dashboard / Inventory / Sales / Graph / Settings.
- Cmd/Ctrl+1..5 shortcut switching.
- UserChip at bottom of sidebar (email + sign-out menu).
- Theme tokens desaturated: less cyan, more zinc/slate; `--up`/`--down`/`--flat` semantic trend colors.

### Phase B2 — Dashboard ✓

Matches Finn's HTML mockup. User identity header (initials avatar + "Tenno_<name>" + "synced X ago · PC" + resync button), 4 summary cards (Total value / Prime parts / Full sets / Ducats), sort + filter chips row, ranked-row list of top 8 items by plat value with vaulted badges and trend icons. Click any row → jumps to Inventory.

### Phase B3 — Inventory with autofill ✓

Replaced the original side-drawer pattern with a unified inline autofill: one search bar that **both** filters owned items in the list below **and** surfaces a floating dropdown of catalog items you don't yet own, each with thumbnail + ducats + current plat + "+ Add" button. Keyboard nav (↑↓ Enter Esc) supported.

Each owned-item row (`RankedRow` with `variant="inventory"`) has hover-revealed qty controls, Sold button (logs at current median, undo toast for 5s), market-link icon (opens `warframe.market/items/<slug>`), and a ⋯ menu for Remove.

### Auth ✓

- Magic-link email (built-in Supabase SMTP — hits the 30/hour free-tier rate limit during dev).
- Google OAuth (no rate limit, instant). Configured in Supabase dashboard + Google Cloud OAuth credentials.

### warframe.market integration (partial) ✓

- **Catalog**: `GET https://api.warframe.market/v2/items` → filter by `tags.includes("prime")` → upsert into `catalog_items`. **730 items** currently loaded (real prime items, filtered tightly via tags rather than a loose slug-substring match).
- **Per-item statistics**: `GET https://api.warframe.market/v1/items/<slug>/statistics` (the v2 statistics endpoint isn't ported yet) → derive 90-day median + 7-day trend → upsert into `price_cache`.
- **Item deeplinks**: every row in Dashboard + Inventory has an external-link icon to that item's warframe.market page.
- **Listings sync** (your active sell orders) → not yet built; that's B7.

---

## What's left (in suggested order)

| Sub-phase | What | Effort | Notes |
|---|---|---|---|
| **B4** | Sales tab: rollups (today/week/month/all-time), top-sales card, history list, edit/delete inline | ~half day | The data is there — every `Sold` click writes a `sale_events` row. Just needs the UI. |
| **B5** | Graph tab: cumulative plat earned (line), plat per day (bar), top items by total plat (bar) | ~half day | `recharts` already installed; pulls from `sale_events` table. |
| **B6** | Vaulted-status enrichment | ~half day | v2 bulk endpoint doesn't expose vault status. Either pull `/v2/items/<slug>` per item (~3500 calls, slow) or merge in `WFCD/warframe-items` JSON once. Latter is cleaner. |
| **B7** | warframe.market listings sync | 1-2 days | New migration for `wfmarket_credentials`/`wfmarket_listings`, two new edge functions (`wfmarket-auth`, `wfmarket-sync`), Settings panel for connect/disconnect, inventory-row badges showing "Listed: 25p". |
| **C** | Set detection ("sell as set vs parts" hint) + bulk paste import | ~1 day | v2 `/v2/items/<slug>` exposes `setRoot`/`setParts` — use that instead of the current slug-derivation heuristic. |
| **D** | Distribution + theme | 1-2 days | Light theme, JSON backup/restore, deploy to Cloudflare Pages / Vercel via GitHub integration, add production URL to Supabase auth's allowed redirects. PWA manifest optional. |

Current sub-decision: **B4 (Sales view) is the natural next step** — the data already flows into `sale_events` every time you click Sold, so wiring up a visualization gives immediate value.

---

## What's been ruled out (don't re-explore)

1. **Steam OpenID → warframe.com session → inventory.** Session works; site doesn't expose inventory. Evidence: full nav map of `/en/user`.
2. **`api.warframe.com/API/PHP/*` (cephalon-sofis era).** Host fully decommissioned, 14 plausible relocations probed, DNS NXDOMAIN on alt subdomains.
3. **`mobile.warframe.com/api/login.php` (Sainan / SpaceNinjaServer endpoint).** Reachable but blocked by Akamai bot manager. Tested across urllib, curl-cffi (4 browser TLS profiles), Playwright `context.request`, and Playwright in-page `fetch()` from correct origin. Sensor cookies never issued.
4. **Sainan-style process-memory extraction on Linux.** Works on Windows; Linux/Proton port is unscoped reverse-engineering. Out of scope for this build.
5. **Tauri desktop shape.** Scaffolded, archived. Cross-device webapp shape was a deliberate UX call, not just a workaround.

If a future conversation suggests any of the above as a "new idea," surface this section.

---

## File map

```
wfinv/
├── HANDOFF.md                     ← you are here
├── warframe-inventory-pricer-PRD.md  ← design spec
├── current-scope.md               ← live decisions log
├── warframe-inventory-research-findings.md  ← reference landscape
├── phase0/
│   └── findings.md                ← full auth-investigation evidence trail
├── _archive-src-tauri/            ← preserved Tauri scaffold from pivot 1→2
├── src/
│   ├── main.tsx                   ← QueryClient + Auth + Toast providers
│   ├── App.tsx                    ← sidebar + route switching
│   ├── theme.css                  ← CSS variable tokens (light + dark)
│   ├── components/
│   │   ├── Sidebar.tsx            ← left nav (220px)
│   │   ├── UserChip.tsx           ← bottom-of-sidebar user + sign-out
│   │   ├── RankedRow.tsx          ← card-style item row, used everywhere
│   │   ├── SearchAutofill.tsx     ← inline catalog autocomplete
│   │   ├── TrendBadge.tsx         ← ▲▼• with semantic colors
│   │   └── Toast.tsx              ← bottom-right toast with undo
│   ├── routes/
│   │   ├── SignIn.tsx             ← Google + magic-link
│   │   ├── Dashboard.tsx          ← matches Finn's mockup
│   │   ├── Inventory.tsx          ← search + autofill + ranked list
│   │   ├── Sales.tsx              ← placeholder (B4)
│   │   ├── Graph.tsx              ← placeholder (B5)
│   │   ├── Settings.tsx           ← catalog/prices refresh + account
│   │   └── index.ts               ← Route type
│   ├── hooks/
│   │   ├── useInventory.ts        ← inventory list + add/setQty/remove/recordSale
│   │   ├── useCatalogSearch.ts    ← fuzzy search of catalog_items
│   │   └── useSummary.ts          ← Dashboard stat cards
│   ├── lib/
│   │   ├── supabase.ts            ← singleton client + marketProxy()
│   │   ├── database.types.ts      ← hand-typed schema (regen via `supabase gen types`)
│   │   ├── auth.tsx               ← AuthProvider + useAuth() (magic-link + Google)
│   │   ├── format.ts              ← fmtInt, timeAgo
│   │   └── wfmarket.ts            ← marketUrl(slug) deeplink helper
│   └── vite-env.d.ts
├── supabase/
│   ├── README.md                  ← one-time setup instructions
│   ├── migrations/
│   │   ├── 0001_init.sql          ← schema + RLS + RPCs
│   │   └── 0002_drop_set_slug_fk.sql  ← drops FK that blocked bulk upsert
│   └── functions/
│       └── market-proxy/
│           └── index.ts           ← Deno edge function, throttled, CORS-friendly
├── .github/
│   └── workflows/
│       └── deploy-supabase.yml    ← auto-redeploys functions on push
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── .env.example                   ← VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
```

`_archive-src-tauri/` is the desktop scaffold from Pivot 1. Don't delete — keep as history.

---

## Operational notes / known gotchas

### Supabase migration tracking

Migration 0001 was applied via the **dashboard SQL Editor** (not via `supabase db push`), so it wasn't tracked in `supabase_migrations.schema_migrations`. To recover (and to push 0002 cleanly), we ran:

```sh
supabase migration repair --status applied 0001
supabase db push --include-all
```

**Going forward:** add new migrations as `supabase/migrations/NNNN_*.sql` files and run `supabase db push` from the terminal — that's the proper path. Don't paste migrations into the dashboard if you can avoid it; it bypasses tracking.

### Edge function deployment

`.github/workflows/deploy-supabase.yml` auto-redeploys `market-proxy` when `supabase/functions/` changes on `main`. **This requires a `SUPABASE_ACCESS_TOKEN` GitHub repo secret** that hasn't been set up yet. Generate one at https://supabase.com/dashboard/account/tokens and add it at https://github.com/finneritter/wfinv/settings/secrets/actions.

Until that secret is set, redeploy manually:

```sh
supabase functions deploy market-proxy --no-verify-jwt
```

(Docker warning is harmless — Supabase falls back to remote builds.)

### warframe.market API quirks

- `/v1/items` is **decommissioned** (returns 404). Catalog must hit `/v2/items`.
- `/v2/items/<slug>/statistics` is **not ported yet** (returns 404). Pricing still hits the legacy `/v1/items/<slug>/statistics`.
- Catalog response shape: `data[].slug`, `data[].i18n.en.{name,thumb}`, `data[].tags`, `data[].ducats`, `data[].gameRef`. Filter to primes via `tags.includes("prime")`, not by slug substring (the slug match would catch "primed" mods which aren't tradeable parts).
- Static asset base URL: `https://warframe.market/static/assets/<thumb path from i18n>`.

### Auth caveats

- **Magic-link email rate limit:** Supabase free tier ships with their built-in SMTP at **30 emails/hour**. Easy to hit during dev. Either wait, sign in with Google instead, or set up Resend for production (3000 free emails/month).
- **Google OAuth + email:** Supabase does NOT auto-link providers. If you sign in with magic link to `finn@example.com` and later sign in with Google for the same email, they create two separate `auth.users` rows. Each has its own `user_id`, and RLS-protected tables (`inventory_items`, `sale_events`) are isolated per user_id. Workaround if this matters: enable "Link Identities" in Supabase auth settings, or stick to one provider.
- **Google "unverified app" warning:** Until the consent screen is verified by Google, users see a yellow "This app isn't verified" page. Click Advanced → Go to wfinv (unsafe). For sharing with anyone outside the test-user list, submit the consent screen for verification.

### Catalog count

Currently **730 items** load on `catalog_refresh`. That's correct — `tags.includes("prime")` filters to actual prime parts + sets, not the looser ~3000 you'd get by slug-substring match. Don't be surprised that it's not 3000+.

### Vaulted status

The v2 bulk catalog endpoint doesn't expose vault status. The orange "vaulted" badge will not light up for any item until B6 lands (vault-status enrichment via per-item v2 calls or WFCD/warframe-items merge).

### Local dev port

Vite runs on port 5173 (was 1420 during the Tauri era; reset for webapp). If you need to change it, both `vite.config.ts` AND the Supabase auth "Site URL" / allowed redirects need to be updated.

---

## Companion docs (read these for depth)

| Doc | What's in it |
|---|---|
| `warframe-inventory-pricer-PRD.md` | Design spec, goals/non-goals, architecture, milestones, acceptance criteria. Updated through Pivot 2. |
| `current-scope.md` | Live decisions log + Phase tracking. The "what we're working on right now" doc. |
| `warframe-inventory-research-findings.md` | Reference landscape (Sainan, SpaceNinjaServer, WFCD/warframe-items, AlecaFrame). Mostly historical now post-pivots. |
| `phase0/findings.md` | Full evidence trail from the auth investigation — every endpoint probed, every response logged. Read if anyone proposes revisiting DE auth. |
| `supabase/README.md` | Step-by-step Supabase project setup (migrations, function deploy, env vars, auth providers). Use this when standing up a new project from scratch. |

---

## Quick reference

- **Repo:** https://github.com/finneritter/wfinv
- **Supabase project ref:** `mpgcusphzngmvyscdiky`
- **Supabase dashboard:** https://supabase.com/dashboard/project/mpgcusphzngmvyscdiky
- **Edge function logs:** https://supabase.com/dashboard/project/mpgcusphzngmvyscdiky/functions/market-proxy/logs
- **GitHub Actions:** https://github.com/finneritter/wfinv/actions
- **Local dev:** `npm run dev` → http://localhost:5173
- **Catalog refresh:** `curl -X POST https://mpgcusphzngmvyscdiky.supabase.co/functions/v1/market-proxy -H "Content-Type: application/json" -H "Authorization: Bearer <anon-key>" -d '{"action":"catalog_refresh"}'`

Owner: Finn (finnellisdev@gmail.com).

Last updated: 2026-05-30.
