# Riven Search — unified stat picker with per-stat value thresholds

**Date:** 2026-06-27
**Scope:** the Riven Search screen (`src/routes/RivenSearch.tsx`) + saved-search persistence
(`riven_saved_searches`). One frontend component rewrite + one additive DB migration.

## Problem

The current `StatPicker` is inconsistent and can't express roll quality:

- **Positives** are a cluster of toggle `Chip` buttons (max 3).
- **Negative** is a single `<select>` dropdown.

Neither lets the user say *how good* a roll must be — e.g. "+Damage of at least 120%", or
"−Zoom no worse than −60%". You can only pick *which* stats, not their values.

## Goal

1. Make both positives and negatives use the **same** control: an "add stat" menu + a list of
   added-stat rows.
2. Give each added stat a **value field** that filters the live auction results by roll quality.
3. Persist those thresholds in saved searches (frontend **and** backend).

## Constraint (why thresholds are client-side)

warframe.market's v1 auction search filters only by *which* stats are present (positive slugs, one
negative, polarity, rolls, MR). It does **not** accept target roll values; the actual rolled
percentages come back per auction in the results. Therefore the value fields are a **client-side
filter** over the returned `RivenResult.attributes`, never sent to the API. This also means they must
**not** become part of `RivenQuery` (which is both the API-search shape and the react-query cache
key — putting thresholds there would refetch on every keystroke).

## UX

Two parallel sections, each built identically: a searchable **"+ Add stat" menu** (reusing the
`.viewmenu` / `.viewopt` dropdown the weapon picker already uses) over a list of rows. Each row =
the signed stat name, a value box, and a remove ✕.

```
Positives (2/3)                         [ + Add stat ▾ ]
  + Damage              min  [ 120 ] %   ✕
  + Critical Chance     min  [  90 ] %   ✕

Negative (1/1)                          [ + Add stat ▾ ]
  − Zoom                max  [  60 ] %   ✕
```

- The add menu lists this weapon's valid attributes, excludes already-picked stats, and is disabled
  once the cap is hit (**3 positives / 1 negative** — matching the API + existing limits).
- Removing a row also clears that stat's threshold.
- Box label is **min** for positives, **max** for negatives; suffix shows the stat's native unit
  (mostly `%`, occasionally `s`). Blank box = no threshold (today's behaviour).

## Filter semantics (client-side, in `Results`)

The picked slugs still drive the warframe.market query exactly as today. Thresholds filter the
*returned* rows; a row passes only if **every** set threshold holds. For each `(slug, X)` in the
threshold map:

- **Positive** slug → the riven must carry that stat as a positive with `value ≥ X`. Absent ⇒ excluded.
- **Negative** slug → if the riven has that negative, require `|value| ≤ X`. If the riven has **no**
  negative at all, it passes (no downside is strictly desirable).

Role (positive vs negative) is determined from `prefs.positives` / `prefs.negative`. Blank/invalid
values are skipped. The filter runs alongside the existing topbar-query filter in the `Results` row
memo; `prefs.minValues`, `prefs.positives`, `prefs.negative` get added to its deps.

## Data model

### Frontend
- `RivenPrefs` gains `minValues: Record<string, string>` (slug → raw input string; empty = none).
  Persisted via the existing localStorage prefs effect.
- `RivenSavedSearch` gains `min_values: Record<string, number>`.
- `RivenQuery` is **unchanged**.
- `loadSaved` applies a saved search's `min_values` into `prefs.minValues` (numbers → strings).
- `saveCurrent` parses `prefs.minValues` (drop blanks/non-finite) and passes it to the create call.

### Backend
- **Migration `0015_riven_search_thresholds.sql`**:
  `ALTER TABLE riven_saved_searches ADD COLUMN min_values TEXT NOT NULL DEFAULT '{}';`
  Additive, safe; JSON object `{slug: number}`. No `PRICING_VERSION` bump (no price-cache impact).
- `rivens::SavedSearch` gains `min_values: HashMap<String, f64>` (serialized to the frontend).
- `db/rivens.rs`:
  - `create_saved` takes an extra `min_values: &HashMap<String, f64>` → `serde_json::to_string`.
  - `map_saved` reads the column → `serde_json::from_str` (default `{}` on empty/parse error).
  - `list_saved` SELECT includes `min_values`.
- `commands.rs::create_riven_search` gains a `min_values: HashMap<String, f64>` argument (separate
  from `query`) and forwards it.
- Update the `saved_search_crud` unit test to pass a threshold map and assert the roundtrip.

## Out of scope / non-effects

- No `PRICING_VERSION` bump. Topbar search schema unchanged. No new market/API calls.
- `riven_saved_searches` remains user data (survives `rebuild_cache`; only `wipe_app` clears it) —
  the new column travels with the row, no special handling.
- Non-percent stats: the box is in the stat's native unit; the filter compares raw `value`
  (with `Math.abs` for negatives), unit-agnostic.

## Verification

- `cargo test` (updated `saved_search_crud`), `cargo clippy`, `tsc`, `biome`, `npm run build`.
- Live spot-check in the dev app: add a positive with a min, confirm low rolls drop; add the
  negative with a max, confirm worse-than rivens drop and no-negative rivens stay; save → reload →
  thresholds restored.
