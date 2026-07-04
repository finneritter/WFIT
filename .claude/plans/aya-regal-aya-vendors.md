# Varzia: Aya vs Regal Aya — correct mapping + per-row currency UI

Status: DONE (2026-07-02) — implemented + verified (cargo 153 tests, tsc/vite, biome, headless screenshot); uncommitted pending Finn's review.

## Verified facts (2026-07-02, live cross-check)

DE raw `worldState.php` → `PrimeVaultTraders[0].Manifest[]` prices each item with exactly
one of two fields; warframestat's `/pc/vaultTrader` wrapper renames them:

| DE field | warframestat field | actual currency | evidence |
|---|---|---|---|
| `PrimePrice` | `ducats` | **Regal Aya** (real-money) | frames = 3, single pack = 6, dual pack = 10, cosmetics 1–2 — known Regal Aya price points |
| `RegularPrice` | `credits` | **Aya** (farmable) | relics ("T{n} Void Projection … Bronze") = 1 — relics cost 1 Aya in game |

Live snapshot: 24 items = 18 regal + 6 aya, `both=0 neither=0` (cleanly bimodal).
WFIT previously read only `ducats` and labeled the column "pays Aya" — i.e. regal prices
mislabeled as Aya, and the 6 actually-Aya relic rows showed no cost at all.

## Design (approved approach: per-row currency unit)

One Varzia column, unchanged order. Each cost cell carries its own currency color +
(in mixed-currency panels only) a small unit label: `1 AYA` / `3 REGAL`. Header meta
lists both ("pays Aya · Regal Aya"), footer splits remaining totals per currency
("0/24 grabbed · 2 aya · 5 regal to go"). Single-currency vendors (Baro/Teshin)
render exactly as before — no unit suffix.

### Backend (Rust owns the mapping)
- `db/vendor.rs::enrich(db, vendor_key, items, base_currency)`: per-item
  `(cost, currency)` — for `varzia`: `credits` present → (`credits`, `"aya"`), else
  (`ducats`, `"regal_aya"`); other vendors: (`ducats`, base). New
  `VendorIntelRow.currency: String`.
- `worldstate/extra.rs`: fix the wrong doc comment on `VendorItem.ducats`; prettify
  Varzia relic-projection names — `"T1 Void Projection Wukong Equinox Vault A Bronze"`
  → `"Lith Relic (Vault A)"` (T1..T4 = Lith/Meso/Neo/Axi; refinement is always Bronze
  = Intact, dropped). `uniqueName` (the `item_ref`) is untouched → manual check-offs persist.
- `worldstate/mod.rs:140` comment fix. Tests updated (varzia parse + enrich currency split).

### Frontend
- `lib/types.ts`: mirror `currency` on `VendorIntelRow`.
- `Vendors.tsx`: cost class from `row.currency`; unit suffix only when the panel's rows
  span >1 currency; header "pays" list = distinct row currencies; `VendorFoot` groups
  remaining cost per currency.
- `home/widgets.tsx` VendorPicks: use the row's own currency (stop stamping panel currency).
- `lib/searchSchemas.ts`: `is:aya`, `is:regal` flags.
- `theme.css`: `--regal` token (dark+light), `.vcost.regal` / `.vfoot .fcost.regal`.

### Docs
- `docs/GAMESTATE_WORLDSTATE.md`: record the verified field mapping.

## Non-goals
- Resolving which specific relic a projection is (uniqueName doesn't encode it).
- Wave-2 vendors (Circuit Incarnon, Nightwave Cred) — separate task.
- Switching Varzia sourcing to DE raw (warframestat stays per worldstate doctrine).
