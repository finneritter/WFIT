# Primely — Economic Data Presentation Reference

> A rulebook for representing the value of a Warframe account/inventory honestly, legibly, and usefully.
> Audience: Claude Code (and any human) building Primely's valuation, overview, and detail surfaces.
> Principle that governs everything below: **a price is a fact about one transaction; a valuation is an estimate about a transaction that hasn't happened yet.** Never present the second as if it were the first.

---

## 0. How to use this document

This is a *decision* reference, not a tutorial. When you (Claude Code) are building any screen, metric, or number in Primely, find the relevant section and follow the rule. Sections are ordered from "the one mental model that matters most" outward to specifics.

The single test to apply to every design choice, borrowed from investment-platform UX practice:

> **Does this make the user more confident, or less — and is that confidence *earned*?**

A number that makes the user feel certain about something that is genuinely uncertain is a bug, not a feature. We are not trying to make the account look as valuable as possible. We are trying to make the user understand their position well enough to make good decisions (sell now / hold / sell for ducats / ignore).

---

# PART I — The core mental model: price ≠ value

Everything Primely does is a version of one question: *"What is this stuff worth?"* That question has no single answer, and pretending it does is the #1 way an inventory-valuation tool misleads people. There are at least four different "worths," and the UI must never silently collapse them into one.

## 1.1 The four "worths" of an item

| Worth | Definition | In Warframe terms | When it's the right number |
|---|---|---|---|
| **Ask / sticker value** | Lowest price someone is *asking* to sell at | Lowest WTS order on warframe.market | What it would cost *you to buy* it |
| **Bid value** | Highest price someone is *offering to buy* at | Highest WTB order | What you could *sell it for right now* |
| **Fair / reference value** | A central estimate of the "real" trading price | Median of recent closed trades | A stable headline estimate |
| **Liquidation value** | What you'd actually net if you sold *your whole pile* | Reference value minus market-impact and time discounts | "What is my account really worth to me, today" |

**The trap:** almost every naive tool computes `sum of lowest ask prices` and calls it "your inventory is worth X." That is the *most* inflated of the four numbers, for two reasons:
1. The ask is the price a *seller wants*, not the price a *buyer pays*. You are a seller. You receive closer to the bid.
2. You cannot sell everything at the marked price simultaneously (see §1.3, market impact).

> **RULE 1 — Default headline = reference value, not ask value.** Compute the account total from median-of-recent-closed-trades, not from lowest asks. If closed-trade data is unavailable for an item, fall back explicitly and flag it (see §3.4).

## 1.2 The bid–ask spread is information, not noise

The gap between the highest buy order and the lowest sell order (the **bid–ask spread**) is a direct readout of how settled an item's price is. A tight spread means the market agrees on the price; a wide spread means it doesn't, and any single "value" you print is shakier. In thin markets the spread widens and the mid-price becomes a poor reference — the wider the spread, the less usable a single midpoint is as a "fair price."

> **RULE 2 — Surface the spread, at least implicitly.** When the spread is wide relative to the price, the per-item confidence must drop and the UI must show a range, not a point. A 12p item with orders from 8p–30p is not "worth 12p" with any confidence.

## 1.3 Market impact: you can't sell it all at the sticker price

This is the concept most missing from existing Warframe net-worth tools and the one that most determines whether Primely is honest. In economics this is **market impact** / **liquidity-adjusted value**: the act of selling moves the price against you. Warframe's plat economy is a real, human-driven, *thin* market — there are only a handful of live buyers for most items at any moment. If you list ten Loki Prime sets, you will clear the top buy orders and the rest sell lower (or not at all that week).

So the true liquidation value of an inventory is **strictly less than** the sum of individual reference values, and the gap grows with:
- how *many* of each item you hold (depth),
- how *illiquid* each item is (volume),
- how *fast* you want the plat (time pressure).

> **RULE 3 — The account total must be a liquidation estimate, not a theoretical sum.** Apply a liquidity/quantity haircut (see §5.1 for the model). At minimum, never imply the user can realize the full theoretical sum.

## 1.4 The Fair Value Hierarchy, applied to Warframe

Accounting (ASC 820) classifies every asset by how observable its price is — this maps onto Warframe almost perfectly and is the cleanest way to assign per-item confidence:

| Tier | Accounting definition | Warframe example | Primely confidence |
|---|---|---|---|
| **Level 1** | Quoted price in an active market | Unvaulted prime set trading many times a day (e.g. a current meta set) | **High** — print a number |
| **Level 2** | No active market, but observable inputs (recent/similar trades) | Vaulted-but-common part, a few trades a week | **Medium** — print a range |
| **Level 3** | Unobservable; value from a model/assumptions | Riven mods, rarely-traded vaulted parts, "almost never sells" | **Low** — print an estimate clearly labeled as such, or decline to value |

> **RULE 4 — Every valued item carries a tier (or equivalent confidence), and the UI treats tiers differently.** Level 3 items should never be summed into the headline with the same visual authority as Level 1. Consider excluding Level 3 from the headline and listing it as "hard-to-value extras."

This is exactly the discipline real institutions use: even with a model price, you compare it against any available market price to test its validity — the model is a fallback, not a substitute, for an observed trade.

---

# PART II — How economists actually reason about value

These are the concepts professional economists/analysts reach for. Each is given with its Warframe translation and a concrete UI consequence.

## 2.1 Liquidity (the master variable)

Liquidity = how easily you can convert the asset to cash (plat) without moving the price. High liquidity → many buyers and sellers, tight spreads, minimal price impact. Low liquidity → few participants, wide spreads, large swings, and you may be stuck holding it.

In Warframe, liquidity is driven by **trade volume** (trades per day) and **consistency** (does it trade *every* day or in occasional bursts). A part worth a nominal 40p that trades twice a month is worth far less *to you this week* than a 40p part that trades hourly.

**UI consequence:** liquidity is not a footnote — it is co-equal with price. Two items at "40p" are not equivalent holdings. Show a liquidity indicator next to value everywhere value appears. (Existing community tools already do this: a 1–10 liquidity score from average daily volume, where 1 = "very hard to sell" and 10 = "trades daily.")

## 2.2 Volatility (how trustworthy is the number)

Volatility = how much the price bounces around. The standard scale-free measure is the **coefficient of variation** (CV = standard deviation ÷ mean). A high CV means the median you print today may be wrong tomorrow.

Community Warframe tools already bucket this into **Stable / Moderate / Volatile** from the CV — copy that. Rivens are the extreme case: effectively their own asset class, with such high dispersion that a single "value" is close to meaningless.

**UI consequence:** volatility sets how wide the displayed range is and how much you round (§3.2). Stable items: tight range, more precision. Volatile items: wide range, heavy rounding, or "varies widely."

## 2.3 Stocks vs flows

A **stock** is a quantity at a point in time (your inventory value *right now*). A **flow** is a rate over time (plat earned per week, value change per day). Users conflate these constantly. "My account is worth 50,000p" (stock) is a completely different claim from "I make 2,000p/week" (flow).

**UI consequence:** keep stock and flow metrics in visually distinct regions. A headline net-worth (stock) and a "value change over 30 days" (flow) must not sit in the same card looking like the same kind of thing. Label time windows explicitly on every flow metric.

## 2.4 The numéraire: platinum is the measuring stick

Economists pick a **numéraire** — the unit everything is priced in. For Primely it's platinum. Two consequences:
- **Don't silently convert to USD.** Plat→USD is itself a contested, ToS-gray, and highly variable number; if you ever show it, isolate it, label it as a rough externality, and never use it in the core valuation.
- **Watch for "plat inflation."** Item prices drift over years as supply grows (relic saturation, un-vaulting). A set that was 1000p years ago can be 40p now. So *historical* plat values are not comparable to today's without context — analogous to **real vs nominal** values in economics. Don't show a 2-year price chart as if old highs are achievable today without noting the regime change.

## 2.5 Aggregation / index-number problem

Summing a heterogeneous inventory into one number is literally building an **index** (like CPI or a stock index). Index theory warns: the total is only as meaningful as its weighting and its components' reliability. A handful of high-value, low-confidence items (one expensive riven) can dominate and destabilize the headline.

**UI consequence:**
- Show the **composition** of the total (what's driving it), not just the total. A treemap or a "top contributors" list answers "*why* is my account worth this?"
- Make the headline robust to one volatile outlier — e.g. report the headline from Level 1+2 items, and show Level 3 (rivens etc.) as a separate, clearly-bounded line.

## 2.6 Substitution & the ducat floor

Economic value has a **floor** when a substitute use exists. In Warframe, every prime part can be dumped for **ducats** (a fixed in-game conversion). That gives almost every prime part a hard floor: its plat value can't meaningfully fall below "the hassle-adjusted equivalent of its ducat value," because below that, rational players just ducat it. This is the **opportunity cost / next-best-use** concept.

**UI consequence:** for low-plat parts, show the **plat-vs-ducat** decision directly ("worth more as ducats"), the single most actionable insight a Warframe valuation tool can give. This is a feature, not a footnote.

## 2.7 Replacement cost & sunk cost (what NOT to value on)

- **Sunk cost:** the time/relics the user spent farming an item is *irrelevant* to its current value. Never let "effort invested" leak into a valuation. Users feel an item is "worth" what it cost them; the market disagrees, and the tool must side with the market.
- **Replacement cost** (what it'd cost to re-acquire) is a *different* and sometimes useful frame ("to rebuild this you'd spend Xp"), but keep it clearly separate from market/liquidation value.

---

# PART III — Honest number presentation (non-negotiable rules)

These are about *the integrity of the numbers themselves*, before any visual styling.

## 3.1 Point estimate + range, never a lonely point

The core habit professional data communicators use: **never present one fixed number where uncertainty is real — display the range where the true value likely falls alongside the central estimate.** A single number implies a precision you don't have.

> **RULE 5 — Any valuation with meaningful uncertainty shows estimate *and* range.** E.g. "≈ 120p (90–160p)". The range comes from recent trade dispersion, not a made-up ±%.

Use **plain language, not statistics jargon.** Practitioner guidance is explicit: say "range of likely values" rather than "95% confidence interval"; the audience associates jargon with false objectivity. Primely's users are gamers, not quants.

## 3.2 Round to your actual confidence (kill false precision)

Decimal platinum prices (e.g. "43.7p") leak from averaging APIs and are a lie — plat trades in whole numbers and the underlying estimate isn't accurate to a tenth. Significant figures should reflect confidence:

| Confidence | Example display |
|---|---|
| High (Level 1, tight spread) | `120p` |
| Medium | `~120p` or `115–130p` |
| Low (volatile/thin) | `~100p` or `roughly 100p` or a wide band |
| Account total | round hard: `~12,400p`, never `12,437p` |

> **RULE 6 — Precision must not exceed confidence.** More decimal places ≠ more trust; it's the opposite tell.

## 3.3 Asymmetry & skew

Trade-price distributions are usually **right-skewed** (a few high outliers). So:
- Prefer the **median** over the mean for the central estimate (the mean is dragged by outliers; this is why warframe.market and most tools default to median).
- Allow **asymmetric ranges** — don't force a symmetric ±. Show the actual lower and upper bounds.

## 3.4 Be explicit about data quality and staleness

- **Volume gate:** below some trade-count threshold, don't print a confident number. Existing tooling uses a `has_sufficient_data` flag — replicate it. If an item has 1 trade in 90 days, that's an anecdote, not a price.
- **Staleness:** WFM orders include `last_update` and seller online-status. Orders from offline sellers / weeks-old listings are not a live market. Prefer **recent closed trades** over open orders, and weight/filter orders by recency and seller presence.
- **Freshness label:** every value should be able to answer "as of when, from how many trades."

> **RULE 7 — Show your work on demand.** Tapping any value reveals: source (closed trades vs orders), sample size, time window, spread. This is the single biggest trust-builder and the cheapest to implement.

## 3.5 Never imply simultaneous full liquidation

Restating Rule 3 as a presentation rule: the headline total must be framed as an *estimate of value*, not a *cash-out button*. If you show "liquidation value," it must carry the assumption ("if sold gradually at current prices") — because dumping it all at once would clear the order book and net less.

---

# PART IV — UX & information architecture

How to lay the honest numbers out so they're legible. Grounded in current fintech/portfolio-dashboard practice.

## 4.1 Visual hierarchy: one hero number, everything else subordinate

Establish a strong **visual weight hierarchy** that guides the eye to the most critical figure first, then to supporting detail. For Primely:
1. **Hero:** the account headline (liquidation estimate) — largest type, bold, top of view.
2. **Secondary:** change-over-time (flow), item count, liquidity-of-account summary.
3. **Tertiary:** per-item breakdowns, charts, tables.

Bold weight + larger size for priority data (total value, net change); smaller/lighter for secondary metrics. Don't let a sparkline or a settings cog compete with the hero number.

## 4.2 Progressive disclosure (the convolution-killer)

This directly answers your stated problem ("without it getting convoluted"). The rule from dashboard practice: **high-level metrics up front; let the user explore down into detail.** Don't dump everything on one screen.

Three layers:
- **Glance:** account value + one trend. Answers "am I up or down."
- **Scan:** grouped cards / top contributors / liquidity & confidence summary. Answers "what's driving it, how solid is it."
- **Drill:** per-item detail with full stats, charts, spread, plat-vs-ducat call. Answers "what do I do about this specific item."

A user should be able to stop at any layer and have a complete, non-misleading picture. Convolution happens when layer 3 detail bleeds into layer 1.

## 4.3 Card-based layout, grouped by meaning

Current fintech dashboards use **card-based layouts** where each card encapsulates one metric/dataset, often with an interactive mini-graph for at-a-glance trend. **Group related indicators** to provide context and cut cognitive load (don't scatter related numbers). For Primely, natural card groups:
- Account value + trend (hero card)
- Composition / top contributors
- Liquidity & confidence health
- Actionable items (sell-now signals, plat-vs-ducat)
- Hard-to-value extras (rivens, thin items) — quarantined

## 4.4 Color semantics — and their accessibility trap

Convention: green for gains, red for losses, high-contrast, used to flag status instantly. **But:**
- ~8% of men have red/green color vision deficiency. **Never encode meaning by color alone** — pair it with an arrow (▲▼), sign (+/−), icon, or label.
- Use color sparingly and consistently; reserve saturated green/red for actual gain/loss, not decoration. Overuse destroys the signal.
- A confidence/liquidity scale should *not* reuse the gain/loss palette — use a separate, perceptually-ordered ramp (e.g. neutral→strong) so users don't read "low liquidity" as "loss."

(Fits Primely's stated Linear/Raycast aesthetic: restrained palette, one accent, semantic color used surgically.)

## 4.5 Interactivity: hover/tap for exact values

Charts should give exact values on hover/tap (tooltips), and support drill-down on tap. Don't bake exact numbers permanently into a chart face — let the chart show *shape*, and reveal *precision* on interaction. This keeps the glance layer clean while preserving access to detail.

## 4.6 Tables — for "what do I own," done right

The inventory list is a table. Rules:
- **Sortable** by every column that implies an action (value, liquidity, confidence, plat-vs-ducat delta, quantity).
- **Right-align numbers**, consistent decimal/rounding, monospace or tabular figures so columns scan vertically.
- Each row should encode value *and* confidence *and* liquidity without the user opening it — e.g. value + a small confidence dot + a liquidity bar.
- Default sort should answer the most common question: probably "what should I sell" (high value × high liquidity), not raw alphabetical.

## 4.7 Charts — pick the right one, sparingly

| Question | Chart | Notes |
|---|---|---|
| Account value over time | line / area | label the window; mark un-vault/vault events that explain jumps |
| Single item price history | line with **shaded range band** (min/max or IQR) | the band *is* the uncertainty; community tools show 48h + 90d |
| What's driving my total | treemap or horizontal bar of top contributors | answers the index-composition question (§2.5) |
| Composition by type/confidence | stacked bar / donut (sparingly) | donuts are weak for comparison; prefer bars |
| Volume / liquidity over time | volume bars under the price line | volume gives the price context |

Avoid: gauges, thermometers, and pie charts for anything requiring comparison or uncertainty — they're poor at both. Use shaded bands / error ranges to *show* uncertainty rather than hiding it behind a clean line.

---

# PART V — Concrete metrics to compute (the toolbox)

Implementable definitions. Tune thresholds against real WFM data; these are sane starting points.

## 5.1 Liquidation-adjusted account value (the headline)

Goal: an honest "what could I realistically get." Per item *i* you hold quantity *qᵢ*:

```
raw_value_i      = median_recent_closed_price_i
liquidity_i      = f(avg_daily_volume_i, trade_consistency_i)   # 0..1
depth_penalty_i  = penalty for selling qty_i into a thin book   # grows with qty_i / daily_volume_i
realizable_i     = raw_value_i * liquidity_factor_i * (1 - depth_penalty_i)

ACCOUNT_HEADLINE = round_to_confidence( Σ realizable_i  over Level 1 & 2 items )
LEVEL_3_EXTRAS   = separately reported band for rivens/thin items
```

- Don't over-engineer the penalty; even a crude "cap quantity contribution at N× daily volume at full price, discount the rest" beats a naive sum.
- Report the headline as a **range**, with the naive theoretical sum available on drill-down so power users see the gap (and learn from it).

## 5.2 Liquidity score (1–10 or 0–1)

From average daily trade volume + consistency (fraction of recent days with ≥1 trade). 1 = "you'll struggle to sell," 10 = "trades daily." Display as a small bar/dot, never as a bare number.

## 5.3 Volatility rating (Stable / Moderate / Volatile)

CV = std(recent prices) / mean(recent prices), bucketed into three labels. Drives range width and rounding. Rivens auto-classify as max volatility.

## 5.4 Confidence tier (Level 1/2/3) — per §1.4

Function of volume (sample size), spread width, and recency. This is the master gate: it decides whether an item gets a point, a range, or a "can't value confidently" treatment, and whether it's in the headline or in "extras."

## 5.5 Plat-vs-ducat recommendation

```
if realizable_plat_value_i  <=  hassle_adjusted_ducat_equivalent_i:
    flag "→ better as ducats"
```

The clearest single piece of advice the app can give for low-value parts. Surface it both per-item and as a roll-up ("23 parts in your inventory are worth more as ducats — ~X ducats total").

## 5.6 Sell signal (optional, label as opinion)

Current price vs longer-window average, as a % deviation (community tools do "current vs 90-day average"). If you ship it, label it clearly as a heuristic, not advice, and never as a guarantee — and keep any "forecast" honestly bounded (linear trend ± a stated range, not a confident prediction).

## 5.7 Time-to-sell estimate

From volume + your quantity: "≈ a day" vs "≈ a few weeks to clear at this price." Often more useful to a player than another digit of price precision, because it converts illiquidity into something tangible.

---

# PART VI — Warframe-specific domain rules

Domain facts that, if ignored, silently corrupt the numbers.

1. **Sets ≠ sum of parts.** A full set usually trades at a *different* (often lower per-part) price than its components summed, because the rarest part dominates and buyers want whole sets. Decide a consistent policy: value held *complete sets* as sets, loose parts as parts, and **never double-count** a part both as a part and as a member of a counted set.
2. **Vaulted vs unvaulted is the biggest price driver.** Vaulting removes an item from farming → supply dwindles → price rises over time; un-vaulting floods supply → price falls. Tag every item with vault status; it's primary context for any price and any trend.
3. **Relic saturation deflates over time.** Long-circulating primes trend cheap; this is structural, not a "deal." Don't present long-run highs as attainable today (§2.4, nominal vs real).
4. **Ducats are the floor** for prime parts (§2.6). Always available as the substitute use.
5. **Rivens are a separate asset class.** Roll-dependent, near-unique, extreme dispersion → Level 3, quarantined from the headline, valued as wide bands or "see detail" only. Riven stats come from a different endpoint (averages/medians/min/max/deviation per weapon) — treat them with their own, lower-confidence pipeline.
6. **Platform matters.** PC / PlayStation / Xbox / Switch are separate markets with separate prices. Never mix platforms in one valuation; make the user's platform an explicit setting.
7. **Order book ≠ trade history.** Open orders (WTS/WTB) show intent; closed trades show reality. Prefer closed trades for value; use open orders for spread and live availability. Filter open orders by seller online-status and recency — a wall of offline/stale listings is not a market.
8. **48h vs 90d windows** serve different purposes: 48h ≈ "right now / current liquidity," 90d ≈ "stable reference / trend." Use the right window for the right claim, and label which you used.

---

# PART VII — Anti-patterns (do NOT ship these)

- ❌ **Sum-of-lowest-asks as "your inventory value."** Inflated and wrong (§1.1). It's the price to *buy*, not *sell*.
- ❌ **Decimal platinum precision** ("43.71p"). False precision (§3.2).
- ❌ **A single bold number with no range or confidence** on a volatile/thin item (§3.1).
- ❌ **Treating a 1-trade-in-90-days item like a priced asset** (§3.4).
- ❌ **Letting one riven swing the headline** (§2.5, §VI.5).
- ❌ **Color-only gain/loss encoding** (§4.4).
- ❌ **Everything on one screen** — the convolution failure mode (§4.2).
- ❌ **Mixing platforms** (§VI.6).
- ❌ **Plat→USD in the core valuation** (§2.4).
- ❌ **Implying you can cash out the whole pile instantly at sticker** (§1.3, §3.5).
- ❌ **Valuing on farm effort / sunk cost** (§2.7).
- ❌ **Gauges/pies/thermometers for uncertain or comparative data** (§4.7).

---

# PART VIII — Quick reference

**The one-line philosophy:** *Show the user what they could realistically get, how sure we are, and how hard it'll be to get it — at a glance, with detail one tap away.*

**Every value displays (implicitly or explicitly): ** estimate · range · confidence · liquidity · as-of.

**Decision flow for valuing any item:**
```
enough recent trades? ──no──► don't print a confident value; "extras" / range only
        │yes
        ▼
spread tight + volume good? ──no──► range + low/med confidence
        │yes
        ▼
Level 1: print a point estimate (still rounded to confidence)
        │
        ▼
low plat value? ──► compare to ducats; flag "better as ducats"
```

**Headline total = Σ(liquidation-adjusted Level 1+2) as a rounded range; rivens & thin items reported separately.**

**The governing question, again:** *Does this make the user more confident, and is that confidence earned?*

---

*This document encodes how economists treat observable vs modeled value (the Fair Value Hierarchy), how thin/illiquid markets break naive valuation (bid–ask spread, market impact, liquidity), how to communicate uncertainty without jargon or false precision, and how modern fintech/portfolio dashboards lay information out (visual hierarchy, progressive disclosure, card grouping, accessible color, interactive detail) — all translated into concrete rules for the Warframe platinum economy.*
