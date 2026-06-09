# Arcane Dissolution & Vosfor — reference

Domain reference for the **Arcanes** screen. Sourced from the official Warframe Wiki
(wiki.warframe.com). The screen answers: which Loid *collection* is the best plat-per-Vosfor to buy,
how much Vosfor you'd get dissolving your unranked arcanes, and whether to sell vs dissolve each owned
arcane.

## The system

After *Whispers in the Walls*, **Loid** (Sanctum Anatomica, Deimos) runs **Arcane Dissolution**:
- **Dissolve** an arcane → **Vosfor** (a per-arcane amount, see below).
- **Spend** Vosfor: every *collection* costs **200 Vosfor + 50,000 credits** and gives **3 random
  unranked arcanes**, each an independent draw from that collection's pool.
- Within a collection, **every arcane in a rarity tier is equally weighted**:
  `P(arcane) = tier_chance / (number of arcanes in that tier)`.

Sources: [/w/Vosfor](https://wiki.warframe.com/w/Vosfor),
[/w/Arcane_Enhancement](https://wiki.warframe.com/w/Arcane_Enhancement),
[/w/Loid_(Original)](https://wiki.warframe.com/w/Loid_(Original)).

## Vosfor dissolution value (per rank-0 arcane)

Authoritative per-arcane values come from the wiki data module `Module:Arcane/data` (field
`Dissolution`). They are **not** a clean function of rarity — they range 12–98. Representative tiers:

| Vosfor | Examples |
|---|---|
| 12 | Exodia Contagion, Exodia Epidemic |
| 14 | Magus / Virtuos commons |
| 18 | Arcane Intention, Exodia Triumph/Valor, several Magus/Virtuos |
| 20 | weapon arcanes (Deadhead/Dexterity/Merciless), chargers |
| 21 | standard Warframe Arcanes (Guardian, Healing, Strike, …) |
| 22 | Blessing, Rise, Cascadia/Conjunction/Emergence/Eternal/Molt families |
| 24 | Akimbo Slip Shot, Battery, Ice Storm, many rares |
| 28 | Aegis, Arachne, Avenger, Fury, Precision, Pulse, Rage, Ultimatum |
| 36 | Pax Bolt/Charge/Seeker/Soar |
| 84 | Escapist, Hot Shot, Reaper, Universal Fallout, Longbow Sharpshot, Melee Crescendo/Duplicate, Secondary Shiver |
| 98 | Barrier, Energize, Grace |

> Vosfor counts **rank-0 (unranked) copies only** — the traded/dissolvable unit. Whether dissolving a
> fused higher-rank arcane refunds more Vosfor is **not wiki-confirmed**, so we value only unranked
> copies. The full slug→vosfor map is bundled in `src-tauri/src/domain/data/arcane_dissolution.tsv`.

**Ranking is a *use* decision, never a profit one — out of scope for the recommender.** Maxing an
arcane to rank 5 costs **21 duplicate copies** (cumulative `1 / 3 / 6 / 10 / 15 / 21`, only duplicates
consumed — no Endo/credits; confirmed at /w/Arcane_Enhancement). A maxed arcane sells for only ~8–9× an
unranked one, so selling 21 unranked copies always nets more plat than selling one maxed. The
recommender therefore never suggests ranking up — it only weighs **sell vs dissolve** on the unranked
spares.

## The 9 Loid collections — drop rates

Each arcane's chance is `tier% ÷ tier-count`. (Source: /w/Arcane_Enhancement, per-arcane percentages.)

| Collection | Common | Uncommon | Rare | Legendary | tier counts |
|---|---|---|---|---|---|
| Eidolon | 40% | 35% | 20% | 5% | C6 · U13 · R8 · L3 (Barrier/Energize/Grace) |
| Duviri | – | 45% | 50% | 5% | U2 · R7 · L3 |
| Cavia | – | 45% | 50% | 5% | U2 · R9 · L2 |
| Necralisk | – | – | 100% | – | R12 |
| Holdfasts | – | – | 100% | – | R19 |
| Höllvania | – | – | 95% | 5% | R8 · L3 (Escapist/Hot Shot/Universal Fallout) |
| Ostron | 10% | 30% | 60% | – | C4 · U7 · R8 |
| Solaris | 15% | 15% | 70% | – | C7 · U4 · R8 |
| Steel | – | – | 100% | – | R11 |

The exact per-collection rosters (which arcane is in which collection) are built into
`arcane_dissolution.tsv` and **validated against these tier counts** (the equal-weight math means each
tier's arcane count is exact). Eidolon and Duviri map 1:1 to the wiki's same-named categories; the
Deimos (Cavia/Necralisk) and Operator (Ostron/Cetus vs Solaris/Fortuna) splits were disambiguated via
the wiki's per-source "Dissolution Efficiency List" and syndicate offerings.

## Expected value (the headline)

For each collection: `EV_plat_per_200Vosfor = 3 × Σ_arcane P(arcane) × rank0_market_plat(arcane)`,
using warframe.market rank-0 medians the app already caches. Report **plat per 200 Vosfor** (one pull)
and **plat per Vosfor**; rank collections descending. Arcanes with no cached price are excluded and
reflected in a per-collection **coverage** figure so the EV's honesty is visible.

**Implied Vosfor value** = the best collection's `plat / Vosfor` (`rate`). This drives the
**sell-vs-dissolve** recommendation, computed per arcane over its **unranked spare copies**
(`rank0_copies`):

- Dissolving one copy is worth `dissolve_unit = vosfor × rate` plat-equivalent — a flat floor.
- Selling is **liquidity-aware**: walk the live demand curve (`buy_orders` best-first, then a
  volume-capped off-book tail at `TAIL_FACTOR × unranked_price`) — the same curve as inventory's
  `realizable_value` — and **sell a copy only while its marginal price beats `dissolve_unit`**; the rest
  are worth more as Vosfor. This is what makes the result *quantity-aware*: you can't dump 30 copies of a
  thin-demand arcane, so its tail dissolves.
- Output per arcane: `sell_qty @ sell_plat` and `dissolve_qty → vosfor` (a stack can split between both).
  `verdict` = the dominant action. Implemented in `db/arcanes.rs::owned` via
  `db/inventory.rs::split_sell_dissolve_default`.

A high-value liquid arcane (e.g. Energize) sells; junk commons (and anything with no price/no demand)
dissolve. No arbitrary plat threshold — Vosfor has no fixed exchange rate, so the rate is derived.

## Data provenance & caveats

- Rarity + Vosfor: `Module:Arcane/data` (authoritative, machine-readable).
- Collection rosters: wiki per-source rosters + categories, checksummed against the tier counts above.
- DE's official drop tables / warframestat.us / WFCD do **not** expose Vosfor collections — this
  dataset is wiki-sourced and bundled (same approach as `mod_rarity.tsv` / vault status).
- Higher-rank dissolution multiplier: unconfirmed; unranked-only by design.

## Existing tools (none compute collection Vosfor-EV)

- **warframe.market** — live arcane buy/sell prices + statistics (the app's price source).
- **Overframe** — arcane database / builds.
- **AlecaFrame** — inventory + warframe.market auto-sync, profit analytics.

This collection-EV calculator appears to be novel — no public tool ranks Loid collections by expected
platinum per Vosfor.
