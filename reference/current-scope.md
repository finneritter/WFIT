# Warframe Inventory Pricer — Current scope

Living document. The PRD is the design spec; this is the live state of the build and the running decisions log. Most-recent-first.

---

## Right now (2026-05-29 evening)

**Webapp + Supabase pivot complete on the code side; awaiting Supabase project creation.**

Phase A scaffold landed:
- Frontend: Vite + React + TS + Tailwind. ✓
- supabase-js client + typed `Database` interface. ✓
- Magic-link `AuthProvider` + `SignIn` route. ✓
- Auth-gated shell with three tabs. ✓
- `Settings` route fully wired: catalog count, refresh catalog, refresh prices, sign out. ✓
- Backend: `supabase/migrations/0001_init.sql` (schema + RLS + RPCs) + `supabase/functions/market-proxy/index.ts` (CORS proxy + cache writer). ✓
- `tsc --noEmit` passes; `vite` boots clean. ✓

### Pinned decisions
- **Webapp, not desktop.** Tauri scaffold archived at `_archive-src-tauri/`.
- **Backend: Supabase.** Postgres + Auth + Edge Functions, free tier.
- **Auth: magic-link email.** No password. Per-device sign-in, syncs your inventory.
- **Per-user data isolation via RLS.** `auth.uid() = user_id` on every per-user table.
- **CORS gap to warframe.market handled by edge function.** Same function also writes catalog/prices using the service role.
- **Visual style:** unchanged from previous pivot — Linear/Raycast-feeling, dark default, Inter + JetBrains Mono with tabular numerals.

### Active next step
Finn does the Supabase one-time setup (see `supabase/README.md`):
1. Create Supabase project at https://supabase.com.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor.
3. Deploy the edge function: `supabase functions deploy market-proxy --no-verify-jwt`.
4. Copy `.env.example` → `.env.local`, fill `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from Project Settings → API.
5. `npm run dev`, sign in, hit Settings → Refresh catalog.

Phase A exit when the catalog count tween-updates after the refresh.

---

## Scope as it stands

The product is a polished web app with warframe.market pricing, magic-link auth, and per-user inventory sync across devices.

**What changed in Pivot 2 (today):**

| Item | Pivot 1 (Tauri desktop) | Pivot 2 (webapp) |
|---|---|---|
| Frontend host | Tauri WebView | Static SPA on Cloudflare Pages / Vercel |
| Backend | Rust core in same binary | Supabase Postgres + Edge Functions |
| Persistence | Local SQLite on user's machine | Postgres, syncs across devices |
| Auth | None | Magic-link email |
| First-launch friction | One-time `sudo pacman -S webkit2gtk-4.1` | None (URL bookmark) |
| Cross-device | No | Yes — sign in anywhere |
| Privacy story | "Cannot leave your machine" | "Cannot see your Warframe account" + RLS per-user isolation |
| warframe.market calls | Direct from Rust `reqwest` | Browser-blocked by CORS → goes through Supabase Edge Function |
| Distribution | AppImage + .dmg artifacts | `git push` → live site |

**What didn't change:**
- React + TS + Tailwind frontend stack and component choices (cmdk, Radix, TanStack Query, react-virtual, recharts).
- UX flows: command palette, ranked list, summary cards, quick-sold (`S`) + sold-with-details (`Shift+S`), Sales rollups, set detection, bulk paste.
- Visual aesthetic (Linear/Raycast, dark default, Inter + JBMono, tabular numerals).
- Data model shape (catalog / inventory / sales / price_cache).
- warframe.market median + trend pricing logic.

---

## What's been ruled out (with evidence)

Phase 0 history is unchanged from Pivot 1's scope doc — Steam OpenID, cephalon-sofis, mobile.warframe.com Akamai bypass attempts, Sainan-on-Linux. Full evidence in `phase0/findings.md`.

**Additional, post-Pivot-2:**

- **Tauri desktop app shape.** Scaffolded fully, then archived in favor of the webapp shape. The one-time `webkit2gtk-4.1` system dep on Linux + the cross-device sync question were the decisive factors. Code preserved at `_archive-src-tauri/` if ever revisited.
- **Pure client-side webapp (no backend).** Considered but rejected: warframe.market's API has no `Access-Control-Allow-Origin` headers, so direct browser calls are CORS-blocked. A backend (Supabase) is needed for the proxy anyway, and we chose to use it for cross-device sync too.

---

## Phase A acceptance checklist

- [x] Vite + React + TS + Tailwind scaffold.
- [x] supabase-js client + typed Database interface.
- [x] Auth provider + magic-link sign-in.
- [x] Auth-gated tab shell with three routes.
- [x] Settings wired to real backend calls.
- [x] Supabase schema + RLS + RPCs (`0001_init.sql`).
- [x] Edge function `market-proxy` for warframe.market.
- [x] `tsc --noEmit` clean; `vite` boots.
- [ ] Supabase project created (Finn).
- [ ] Migration run in SQL editor (Finn).
- [ ] Edge function deployed (Finn).
- [ ] `.env.local` filled with project URL + anon key (Finn).
- [ ] Magic-link sign-in tested end-to-end.
- [ ] Catalog refresh button populates `catalog_items` with ~3000 rows.

---

## Phase B prep (the UX phase)

When Finn finishes the Supabase setup and Phase A closes:
- Command palette built on `cmdk`, talking to `catalog_items` (fuzzy search via Postgres `pg_trgm` already configured in the migration).
- Inventory list virtualized with `react-virtual`, querying joined inventory × catalog × price_cache.
- Quick-sold `S` keyboard handler calling `record_sale` RPC; `Cmd/Ctrl+Z` undo within 5s.
- Sold-with-details inline form (`Shift+S`) calling `record_sale` with explicit `plat_per_unit`.
- Summary cards driven by `inventory_summary` RPC, with tweened number transitions.
- Dark-theme polish: typography, spacing, micro-animations on qty change.

---

## References (live)

- Supabase docs: https://supabase.com/docs
- warframe.market API: https://warframe.market/api_docs
- WFCD items (Phase B+ enrichment): https://github.com/WFCD/warframe-items
- cmdk: https://github.com/pacocoursey/cmdk
- Radix UI: https://radix-ui.com
- TanStack Query: https://tanstack.com/query
