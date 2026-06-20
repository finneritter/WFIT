# Valuing Inventory in Primely: The Liquidity Problem

> A design note on why `price × quantity` lies to you, and how to compute an
> honest account-worth number from warframe.market data.

---

## 1. The problem, stated plainly

Primely shows a holistic value for a Warframe account: "your inventory is worth
*X* platinum." The obvious way to compute that is, for every item you own:

```
item_value = last_or_recent_sale_price × quantity_held
account_value = Σ item_value
```

This is wrong, and it's wrong in a specific, predictable direction: **it
massively overvalues common, high-quantity holdings.**

The canonical example: you hold **500 copies of a common mod**. One time in the
last week, a single copy sold for **3 platinum**. The naive formula reports
**1,500 platinum** for that stack. In reality you could never sell 500 copies at
3p each — the mod is everywhere, demand is near zero, and after offloading two
or three to the only buyers who exist, the rest are effectively unsellable. The
*true* liquid value of that stack is maybe **5 platinum**, not 1,500.

Multiply that error across a whole account full of common drops and your
"net worth" number becomes pure fantasy. Worse, it's the kind of fantasy that
makes the app feel like it's lying to the user — which it is.

This document explains *why* the error happens (it's a real and well-understood
economics problem, not a Warframe quirk) and lays out the recommended fix.

---

## 2. Why the naive formula fails: marginal price vs. average value

The single most important idea here:

> **A market price is a *marginal* price. It tells you the value of *one more*
> unit at the current margin — not the value of every unit you own.**

When you scrape a 3p sale, that 3p is what *one* buyer paid for *one* copy at the
margin. The `× quantity` step silently assumes there are 500 more buyers, each
standing ready to pay that same 3p *at the same time*. That assumption is false
for almost everything common.

The correct mental model is a **demand curve**. Buyers are sorted by how much
they're willing to pay. The first buyer might pay 3p, the next 2p, the next 1p,
and then... nobody. The true value of your stack is the **area under the demand
curve up to your quantity** — not a rectangle of `price × quantity`.

```
Price
 3p |■
 2p |■ ■
 1p |■ ■ ■
 0p |■ ■ ■ . . . . . . . . . . . . . . . . . . (497 more units, no buyers)
    +--------------------------------------------> Quantity you try to sell
     1 2 3                                    500

Naive value : 3p × 500            = 1500p   (the whole rectangle — fiction)
Real value  : 3p + 2p + 1p + 0... = ~6p     (area under the curve — honest)
```

For a **rare, in-demand item** (say a desirable Prime set), the demand curve
stays flat for a long way — there are plenty of buyers near the quoted price — so
the rectangle and the area are nearly the same, and `price × quantity` is roughly
fine. **Primely's job is to tell these two cases apart automatically**, and the
naive formula structurally cannot.

---

## 3. How the real world handles this

This is a solved problem in finance, accounting, and asset appraisal. The
relevant concepts, and what each one buys us:

| Concept | What it means | What we take from it |
|---|---|---|
| **Marginal vs. average value** | Price reflects the *next* unit, not all units. Holding a lot crushes your marginal value (diamond–water paradox). | Don't extrapolate one price across a whole stack. |
| **Market impact / slippage** | Large sell orders push the price against you. The first unit fills at the quote; later units fill worse. | Value a stack by *walking down* available demand, not flat-multiplying. |
| **Bid vs. ask vs. last trade** | "The price" is three different numbers. What you can *get right now* is the **bid** (standing buy orders). | Value against buy orders, not sell orders or trade history. |
| **Blockage / illiquidity discount** | Appraisers (and the IRS) explicitly mark *down* a large block that can't be sold without tanking the price. | A high-quantity holding in a thin market is worth less per unit than a single copy. |
| **Mark-to-market vs. liquidation value** | Paper value vs. what you'd actually realize on a sale. | Surface the *realizable* number as the headline. |
| **Robust statistics (median, trimmed mean)** | Outlier-resistant measures of central tendency. | Never use last-sale or max; a single 3p print is an outlier. |

The thread tying them together: **value is set at the margin, against actual
demand.** Everything below is just applying that to warframe.market's data.

---

## 4. The warframe.market data model

> ⚠️ **Verify against the current API docs** (`api.warframe.market`) before
> wiring this up — endpoints and field names drift between API versions. The
> shapes below are the general structure to design around, not a contract.

Two data sources matter for valuation:

**A. Live orders** — `/items/{url_name}/orders`
Each order has roughly:
- `platinum` — price per unit
- `quantity` — how many at that price
- `order_type` — `"buy"` or `"sell"`
- `user.status` — `"ingame"`, `"online"`, or `"offline"`
- `mod_rank` (for mods) — rank 0 vs. max rank are *different goods* at
  *different prices*
- `platform`

The **buy orders** are the standing demand — the bids. This is the gold for
liquidation valuation: it's literally a snapshot of the demand curve.

**B. Historical statistics** — `/items/{url_name}/statistics`
Closed-trade aggregates over windows (e.g. 48h and 90d), per bucket:
- `volume` — units traded
- `min_price`, `max_price`, `avg_price`
- `median`
- `moving_avg`

This is the fallback when an item has no live buy orders, and the source of the
**liquidity signal** (volume → how fast you could realistically sell).

Two practical filters that matter a lot:
- **Only count `ingame`/`online` buyers** for "what can I get *now*." An offline
  buyer's order can't transact this minute.
- **Match `mod_rank`** (and platform). A maxed mod and a rank-0 mod are not
  interchangeable; valuing one against the other's orders is a bug.

---

## 5. The recommended fix: liquidate against the order book

Instead of `price × quantity`, value each stack by **simulating selling it into
the standing buy orders**, best price first, until you run out of inventory or
run out of buyers. Whatever can't be filled is worth ~0 (or a tiny "someday"
residual).

### Algorithm (reference, Python-ish)

```python
def realizable_value(quantity, buy_orders):
    """
    buy_orders: list of (price, qty) for matching item/rank/platform,
                filtered to ingame/online buyers.
    Returns the platinum you'd actually realize liquidating `quantity`.
    """
    buy_orders.sort(key=lambda o: o.price, reverse=True)  # best bid first
    remaining = quantity
    total = 0
    for price, qty in buy_orders:
        fill = min(remaining, qty)
        total += fill * price
        remaining -= fill
        if remaining == 0:
            break
    # `remaining` units are unsellable right now -> contribute ~0
    return total
```

Run this on the 500-common-mod case: maybe 3 buyers exist at 1–2p, then nothing,
so you realize ~5p — the honest answer. Run it on a deep-demand Prime set and
you'll fill most of your quantity near the quoted price. **The model
self-corrects for liquidity with no hardcoded item lists.** That's the whole
point: liquidity falls out of the data instead of being something you guess.

### Rust sketch (Primely's stack)

```rust
struct BuyOrder {
    price: u32,
    quantity: u32,
}

/// Platinum realizable by liquidating `held` units into current demand.
/// `orders` should already be filtered to matching rank/platform and
/// to ingame/online buyers.
fn realizable_value(held: u32, mut orders: Vec<BuyOrder>) -> u32 {
    orders.sort_unstable_by(|a, b| b.price.cmp(&a.price)); // best bid first
    let mut remaining = held;
    let mut total = 0u32;
    for o in orders {
        if remaining == 0 {
            break;
        }
        let fill = remaining.min(o.quantity);
        total += fill * o.price;
        remaining -= fill;
    }
    total // unfilled `remaining` units count as 0
}
```

---

## 6. Fallback for items with no live buy orders

Plenty of items have *no* standing bids at a given moment, even though they do
trade. For those, fall back to a **volume-capped median**, never to last-sale or
max:

```
window_volume  = units traded over a chosen window (e.g. 90d)
sellable       = min(quantity, k * window_volume)   # k ~ realistic share you'd capture
median_price   = median of closed trades in window

value = sellable * median_price
      + (quantity - sellable) * median_price * residual_factor   # residual_factor ~ 0.05
```

Why each piece:
- **Median, not max/last** — robust to the outlier 3p print. A single weird sale
  can't move it.
- **Volume cap** — you can only realistically sell what the market actually
  absorbs. Holding 500 of something that trades twice a week means almost none of
  it is liquid.
- **Residual factor** — the leftover isn't *worthless* forever, but it shouldn't
  count near full price. A small fraction keeps the number honest without zeroing
  it out entirely.

Order-book liquidation (§5) is always preferred when bids exist; this is the
graceful degradation when they don't.

---

## 7. Don't show one number — show a model

A single value with false precision is what makes these apps feel dishonest.
Surface the structure instead:

- **Liquid value (headline)** — realizable value from §5/§6. This is "what your
  account is actually worth if you sold sensibly." Make it the big number.
- **Ceiling / paper value (muted)** — the optimistic `median × quantity` mark.
  Useful as an upper bound, clearly labeled as *not* realizable. Keep it
  secondary so nobody mistakes it for cash.
- **Liquidity signal, per item** — e.g. `days_to_liquidate = quantity /
  daily_volume`. When that reads "247 weeks," the user *instantly* understands
  why their 500 mods aren't money. This single derived stat does more for trust
  than any tooltip.

Optionally, group inventory into **liquid / slow / dead** tiers by liquidity so
the user sees at a glance where their real value lives (usually a handful of
desirable sets) versus where it merely *looks* like value (a long tail of common
junk).

---

## 8. Edge cases & gotchas

- **Rank-able mods** — value rank-0 against rank-0 orders, maxed against maxed.
  Treat ranks as distinct goods; never pool them.
- **Sets vs. parts** — a full set is often worth more than the sum of its parts,
  and sometimes less if parts are individually liquid. Decide explicitly how
  Primely treats "I have the parts to build a set" vs. "I have a built set."
- **Platform split** — PC / console markets are separate. Don't mix order books.
- **Stale orders** — even `ingame`/`online` orders can be abandoned. Treating
  online-only buyers as the realistic demand mitigates this; you may also cap
  per-order fill confidence.
- **Self-impact over time** — even the order-book method is a *snapshot*.
  Dumping a large stack would also move the price over the days it takes to sell.
  For a v1, the snapshot is plenty honest; just don't claim it's a guaranteed
  liquidation price.
- **Plat-sink items / vaulted goods** — thin volume plus occasional high prints.
  The median + volume cap handles these correctly; the naive formula does not.

---

## 9. TL;DR

The bug isn't a Warframe quirk — it's the classic mistake of treating a
**marginal price as if it applied to an entire stack**. Markets price the *next*
unit, not all your units.

**Fix:** value every holding by *liquidating it against actual standing demand*
(buy orders, best-first), falling back to a *volume-capped median* when no bids
exist. Show the **realizable** number as the headline, keep the optimistic
`price × quantity` as a clearly-labeled ceiling, and surface a **days-to-sell**
liquidity stat so the user understands the difference.

Do that and Primely stops telling people their 500 common mods are worth 1,500
platinum — and starts telling them the truth.
