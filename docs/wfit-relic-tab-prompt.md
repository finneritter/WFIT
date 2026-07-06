# WFIT Relic Tab — Research Brief & Implementation Guidance

You are working on **WFIT**, a Tauri (Rust backend) desktop app for Warframe inventory tracking and platinum valuation. It pulls pricing from the warframe.market API and its differentiating strength is a realistic valuation engine: liquidation-adjusted value, bid-ask awareness, and illiquidity discounts — rather than naive average prices.

The current **relic tab is underdeveloped**. Your job is to research, design, and incrementally build a best-in-class relic tab. Below is a summary of prior research; use it as your starting map, verify anything load-bearing, and extend it with your own research where flagged.

---

## Research summary (already completed — treat as strong priors, verify before hardcoding)

### Competitor landscape

**AlecaFrame** (Overwolf, Windows-only) is the benchmark. Its Relic Planner supports:
- Filters: vaulted status, all-rewards-owned, all-frames/weapons-mastered, owns-10+-copies, refinement state (Intact/Exceptional/Flawless/Radiant), favorites
- **Squad-size-aware EV**: user selects how many squad members run the same relic (1–4); expected platinum/ducats and effective drop rates recalculate. Docs explicitly frame the tradeoff: same-relic squads for time-efficiency, one-relic-per-squad (stagger) for relic-efficiency
- Goal-oriented sort modes: "Best for MR" (relics that help build unowned items), favorites-first
- Known weakness: in endless fissure missions, its inventory data goes stale (only updates on loading screens), so its overlay shows relics the player no longer owns

**VoidStonks** (web, April 2026) exists specifically for players who can't run overlays (console/Linux/mobile). Features signal unmet demand: per-relic average plat by refinement level AND squad size, drop tables with direct warframe.market links, prime set completion tracking (pick a missing part → see which relics drop it), sort inventory by "most profitable," fissure optimizer highlighting fast Steel Path/Omnia fissures matching the relic era.

**WFInfo** does OCR-based reward screens and part/relic tracking but is regarded as buggy for relic tracking.

**WFIT's structural advantage:** native Tauri app runs on Linux where AlecaFrame cannot, and the valuation engine can compute *realistic* relic EV where every competitor uses naive averages.

### Community pain points (Warframe forums, 2022–2026)

- 557+ distinct relics exist; the in-game UI's sorting/filtering is widely considered inadequate
- The single most-requested feature, recurring for 4+ years: **vaulted/unvaulted filtering**, driven by fear of accidentally burning vaulted relics in pub missions → implies both a filter and a "protected / do-not-burn" flag
- Players think in goals (make plat, gain MR, complete a set, farm a specific part), not in a single sort order

### Void Cascade / endurance player needs

- Cascade rewards on an AABC rotation every 4 retired Exolizers; endless fissures escalate: reward boosters scale to 2x, every 5th interval after 15 grants a random Radiant relic, and bonus relics are usable **in the same mission**
- Cascade's node is an **Omnia fissure**: the player picks any relic tier (Lith/Meso/Neo/Axi). So the pre-session question is "across my entire inventory, what is my optimal burn order?" — not "which Axi relic"
- Long sessions consume dozens of relics; a session/consumption model (even manual decrement) beats the incumbent's stale-data failure mode
- Trace economics matter: Intact ≈ 25.33%/11%/2% (common/uncommon/rare) vs Radiant ≈ 16.67%/20%/10%; refinement costs 25/50/100 traces (Exceptional/Flawless/Radiant). Rough break-even heuristic: radiate when (rare_plat − common_plat) × ~8% > plat-value of 100 traces. Scaling is non-linear — Intact→Exceptional doubles rare rate for only 25 traces, so intermediate tiers sometimes win on traces-per-percentage
- Radshare math: 4-player radiant share ⇒ ~34.39% chance at least one rare appears per run vs 10% solo radiant (union probability, 1 − 0.9⁴)

### Market-cycle economics (fits WFIT's valuation DNA)

Relic values follow vault cycles: post-vault scarcity pushes rare parts to 100–300+ plat for ~1–3 months; prices decline 30–60% after 6+ months as supply stabilizes. A relic is an asset with time-varying EV → enables a "hold vs crack" signal.

### Prioritized feature list (impact/effort, ship 1–3 first)

1. **EV columns per relic** — plat EV + ducat EV, per refinement tier × squad size toggle (1–4), computed with WFIT's liquidation-adjusted pricing. Flagship differentiator.
2. **Vaulted filter + protected flag** — the community's #1 ask; visual marking plus user-pinnable do-not-burn.
3. **Burn-order view** — whole-inventory (all tiers, Omnia-aware) sort by EV descending, with junk filters (all-rewards-owned, 10+ copies, all-drops-below-N-plat). The "what do I feed the cascade furnace" screen.
4. **Refinement ROI calculator** — per relic: EV delta per refinement tier vs trace cost, break-even trace value, including intermediate tiers.
5. **Reverse lookup / target farming** — pick a prime part → owned relics that drop it, odds per refinement, radshare vs stagger math.
6. **Hold-vs-crack signal** — flag relics whose contents are vaulting soon / recently vaulted as appreciating; extend liquidation logic into the time dimension.

---

## Your own research tasks (do these before/while implementing)

1. **Data sources — verify and choose:**
   - Official drop tables: https://www.warframe.com/droptables (HTML; check community-maintained parsed mirrors, e.g. the WFCD org on GitHub — `warframe-items`, `warframe-drop-data` — for relic→reward mappings, rarity tiers, and vaulted status)
   - warframe.market API for part prices (WFIT already integrates this; reuse the existing client and rate-limit handling, cache aggressively — relic drop tables change only on game updates)
   - Ducat values per part (fixed: common 15, uncommon 45, rare 100 — verify edge cases like Forma, which has no ducat/trade value and must be handled as a zero-plat, zero-ducat outcome in EV)
   - Confirm current refinement drop-rate tables from official data rather than the approximations above
2. **Verify the EV math** before implementing: per-refinement rarity-tier probabilities split evenly among items within a tier (3 commons, 2 uncommons, 1 rare); squad "best-of-N" EV = expected max-value pick across N independent rolls, which is NOT N× single EV — model it correctly (enumerate outcomes or Monte Carlo, then close-form if feasible).
3. **Decide the valuation layer integration:** how relic EV consumes WFIT's liquidation-adjusted part prices. Key question: for EV, should each drop use expected realizable sale price (liquidation-adjusted) rather than lowest listed sell? Yes — document the assumption in code and UI tooltip.
4. **Vaulted-status data:** find a reliable, updatable source for which relics are vaulted vs available (check `warframe-items` metadata; validate against a few known relics).
5. **Check what has changed recently:** search for Warframe updates affecting relics, refinement rates, Omnia fissures, or Void Cascade rewards newer than mid-2026 before hardcoding constants.

## Implementation guidance

- Keep constants (drop rates, trace costs, ducat values) in a single well-documented Rust module; they change rarely but visibly on game updates
- Compute EV in Rust, not the frontend; expose per-relic records: `{ relic, refinement, squad_size } → { plat_ev, ducat_ev, top_drop, vaulted, owned_count }`
- Cache market prices with TTL consistent with the rest of WFIT; relic static data can be bundled and refreshed on demand
- UI should follow WFIT's existing minimal aesthetic; default view = burn-order sort with vaulted relics visually distinct and protected relics excluded from burn order
- Ship incrementally in the priority order above; each feature should be independently usable

Start by restating your plan, listing what you'll verify vs assume, then proceed.
