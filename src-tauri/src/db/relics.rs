//! Owned void relics: storage + drop-based valuation. Relics aren't traded on
//! warframe.market, so a relic's worth is the expected plat of what it can drop —
//! Σ (drop chance × the drop's market price), reusing `prices::effective_price` and
//! resolving drop display names to catalog slugs via `catalog::name_slug_map`.
//! Unpriceable drops (Forma, Kuva, Requiem mods) simply contribute nothing.

use crate::db::wanted::CrackSignals;
use crate::db::{catalog, prices, Db};
use crate::domain::relic;
use crate::error::{AppError, AppResult};
use crate::types::{
    CrackSet, RefinementChance, RelicBrowserRow, RelicDetail, RelicDetailDrop, RelicRefinementInfo,
    RelicSourceRow, RelicStack,
};
use chrono::Utc;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};

fn display_name(tier: &str, name: &str) -> String {
    format!("{tier} {name}")
}

/// Combined-priority weights for the burn-order score. Each tier dwarfs the next so
/// the categorical signals strictly order relics and EV only breaks ties: completes a
/// one-away set → drops a watch/buy-list item → expected value. Vaulted is NOT a
/// factor (it's a display tag only), and protection demotes UI-side only. There is
/// no crackable-now signal: Omnia fissures take any tier, so it's always true.
const W_SET: f64 = 1_000_000.0; // × count of one-away set parts dropped
const W_WANTED: f64 = 100_000.0; // × min(count, 3)

// ===========================================================================
// Full-catalog relic browser (the reworked Relics screen): every known relic,
// owned or not, valued with squad-aware drop EV from preloaded price maps.
// ===========================================================================

/// Cumulative trace cost to refine from Intact.
const TRACE_COSTS: [(&str, i64); 3] = [("Exceptional", 25), ("Flawless", 50), ("Radiant", 100)];

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// Everything a browser/detail pass needs, preloaded in one pooled read so the
/// per-relic work is pure in-memory math (pattern: `inventory::owned_holdings`).
struct BrowserCtx {
    name_to_slug: HashMap<String, String>,
    prices: prices::PriceMaps,
    ducats: HashMap<String, i64>,
    owned_parts: HashMap<String, i64>,
    stacks: HashMap<(String, String), Vec<RelicStack>>,
    protected: HashSet<(String, String)>,
}

fn load_ctx(c: &Connection, name_to_slug: HashMap<String, String>) -> AppResult<BrowserCtx> {
    let prices = prices::load_price_maps_all(c)?;
    let mut ducats = HashMap::new();
    let mut stmt = c.prepare("SELECT slug, ducats FROM catalog_items WHERE ducats IS NOT NULL")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
        let (slug, d) = row?;
        ducats.insert(slug, d);
    }
    let mut owned_parts = HashMap::new();
    let mut stmt = c.prepare("SELECT slug, qty FROM inventory_items WHERE qty > 0")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
        let (slug, q) = row?;
        owned_parts.insert(slug, q);
    }
    let mut stacks: HashMap<(String, String), Vec<RelicStack>> = HashMap::new();
    let mut stmt = c.prepare(
        "SELECT tier, relic_name, refinement, qty, source FROM owned_relics WHERE qty > 0",
    )?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, String>(4)?,
        ))
    })? {
        let (tier, name, refinement, qty, source) = row?;
        stacks.entry((tier, name)).or_default().push(RelicStack {
            refinement,
            qty,
            source,
        });
    }
    // Worst → best refinement, so the "Int ×3 · Rad ×2" sub-line reads in order.
    let rank = |r: &str| relic::REFINEMENTS.iter().position(|x| *x == r).unwrap_or(9);
    for v in stacks.values_mut() {
        v.sort_by_key(|s| rank(&s.refinement));
    }
    let mut protected = HashSet::new();
    let mut stmt = c.prepare("SELECT tier, relic_name FROM relic_prefs WHERE protected = 1")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        protected.insert(row?);
    }
    Ok(BrowserCtx {
        name_to_slug,
        prices,
        ducats,
        owned_parts,
        stacks,
        protected,
    })
}

/// Valuation of one relic at one refinement. `None` when the refinement has no
/// drop table (Requiem Eterna is Intact-only — never assume all four exist).
struct RefinementEval {
    ev_plat: f64, // best-of-squad
    ev_solo: f64, // linear
    ducat_ev: f64,
    p_rare: f64,
    drops_owned: i64, // of the slug-resolvable rewards, how many are owned ≥1
    drops_total: i64, // slug-resolvable rewards (Forma/Requiem mods excluded)
    best: Option<(String, i64)>,
}

fn eval_refinement(
    ctx: &BrowserCtx,
    tier: &str,
    name: &str,
    refinement: &str,
    squad: u32,
) -> Option<RefinementEval> {
    let drops = relic::drops_for(tier, name, refinement)?;
    let mut pairs = Vec::with_capacity(drops.len());
    let mut ducat_ev = 0.0;
    let (mut owned, mut total) = (0i64, 0i64);
    let mut best: Option<(String, i64)> = None;
    for d in &drops {
        let slug = ctx
            .name_to_slug
            .get(&catalog::normalize_name(&d.reward_name));
        let plat = slug.and_then(|s| prices::effective_price_from(&ctx.prices, s, None));
        // Unpriceable rewards enter the distribution at 0 — they still soak squad rolls.
        pairs.push((d.chance, plat.unwrap_or(0)));
        if let Some(s) = slug {
            total += 1;
            if ctx.owned_parts.get(s).copied().unwrap_or(0) > 0 {
                owned += 1;
            }
            if let Some(du) = ctx.ducats.get(s) {
                ducat_ev += d.chance / 100.0 * *du as f64;
            }
        }
        if let Some(p) = plat {
            if best.as_ref().map(|(_, bp)| p > *bp).unwrap_or(true) {
                best = Some((d.reward_name.clone(), p));
            }
        }
    }
    Some(RefinementEval {
        ev_plat: round1(relic::squad_ev(&pairs, squad)),
        ev_solo: round1(relic::squad_ev(&pairs, 1)),
        ducat_ev: round1(ducat_ev),
        p_rare: relic::p_rare_at_least_one(&pairs, squad),
        drops_owned: owned,
        drops_total: total,
        best,
    })
}

/// The gold-tier (rare) rewards of a table: those at the lowest listed chance.
/// A flat table (Requiem Eterna — every reward equal) has no rarity tiers → empty.
fn rare_names(drops: &[relic::RelicReward]) -> HashSet<String> {
    let positive = drops.iter().map(|d| d.chance).filter(|c| *c > 0.0);
    let (Some(min), Some(max)) = (
        positive.clone().min_by(f64::total_cmp),
        positive.max_by(f64::total_cmp),
    ) else {
        return HashSet::new();
    };
    if (max - min).abs() < 1e-9 {
        return HashSet::new();
    }
    drops
        .iter()
        .filter(|d| (d.chance - min).abs() < 1e-9)
        .map(|d| d.reward_name.clone())
        .collect()
}

/// The rare drop to headline for a relic: the highest-valued member of the
/// rare group (in practice the single gold reward), with its price.
fn rare_of(ctx: &BrowserCtx, drops: &[relic::RelicReward]) -> Option<(String, Option<i64>)> {
    let rare = rare_names(drops);
    drops
        .iter()
        .filter(|d| rare.contains(&d.reward_name))
        .map(|d| {
            let plat = ctx
                .name_to_slug
                .get(&catalog::normalize_name(&d.reward_name))
                .and_then(|s| prices::effective_price_from(&ctx.prices, s, None));
            (d.reward_name.clone(), plat)
        })
        .max_by_key(|(_, plat)| plat.unwrap_or(-1))
}

/// The first refinement a relic actually has a drop table for (normally Intact).
fn base_refinement(tier: &str, name: &str) -> Option<&'static str> {
    relic::REFINEMENTS
        .iter()
        .find(|r| relic::drops_for(tier, name, r).is_some())
        .copied()
}

/// Every known relic as a browser row: catalog facts + ownership + squad-aware EV +
/// burn signals. Row EV is the qty-weighted mean over owned refinement stacks
/// (what your actual holdings return per crack); base-refinement EV when unowned.
/// `aya` = identities currently sold by Varzia for Aya (vaulted-but-buyable).
pub fn browser_rows(
    db: &Db,
    sig: &CrackSignals,
    aya: &HashSet<(String, String)>,
    squad: u32,
) -> AppResult<Vec<RelicBrowserRow>> {
    let name_to_slug = catalog::name_slug_map(db)?;
    db.read(|c| {
        let ctx = load_ctx(c, name_to_slug)?;
        let mut out = Vec::new();
        for (tier, name) in relic::all_relics() {
            let Some(base_ref) = base_refinement(&tier, &name) else {
                continue; // identified but no reward table — data gap, nothing to show
            };
            let Some(base) = eval_refinement(&ctx, &tier, &name, base_ref, squad) else {
                continue;
            };
            let stacks = ctx
                .stacks
                .get(&(tier.clone(), name.clone()))
                .cloned()
                .unwrap_or_default();
            let qty: i64 = stacks.iter().map(|s| s.qty).sum();
            let (ev_plat, ducat_ev) = if qty > 0 {
                let (mut ev, mut dev, mut w) = (0.0, 0.0, 0.0);
                for st in &stacks {
                    if let Some(e) = eval_refinement(&ctx, &tier, &name, &st.refinement, squad) {
                        ev += e.ev_plat * st.qty as f64;
                        dev += e.ducat_ev * st.qty as f64;
                        w += st.qty as f64;
                    }
                }
                if w > 0.0 {
                    (round1(ev / w), round1(dev / w))
                } else {
                    (base.ev_plat, base.ducat_ev)
                }
            } else {
                (base.ev_plat, base.ducat_ev)
            };
            // Signals + search haystack from the base reward table (the reward set is
            // the same at every refinement; only chances differ).
            let drops = relic::drops_for(&tier, &name, base_ref).unwrap_or_default();
            let mut drop_names = Vec::with_capacity(drops.len());
            let mut sets: Vec<CrackSet> = Vec::new();
            let (mut set_count, mut wanted_count) = (0i64, 0i64);
            for d in &drops {
                drop_names.push(d.reward_name.clone());
                let Some(slug) = ctx
                    .name_to_slug
                    .get(&catalog::normalize_name(&d.reward_name))
                else {
                    continue;
                };
                if sig.watch_buy.contains(slug) {
                    wanted_count += 1;
                }
                if let Some((set_slug, set_name)) = sig.one_away.get(slug) {
                    set_count += 1;
                    if !sets.iter().any(|s| &s.slug == set_slug) {
                        sets.push(CrackSet {
                            slug: set_slug.clone(),
                            name: set_name.clone(),
                        });
                    }
                }
            }
            let score =
                W_SET * set_count as f64 + W_WANTED * (wanted_count.min(3) as f64) + ev_plat;
            let (best_reward, best_reward_plat) = match base.best {
                Some((n, p)) => (Some(n), Some(p)),
                None => (None, None),
            };
            let (rare_reward, rare_plat) = match rare_of(&ctx, &drops) {
                Some((n, p)) => (Some(n), p),
                None => (None, None),
            };
            out.push(RelicBrowserRow {
                display_name: display_name(&tier, &name),
                vaulted: relic::is_vaulted(&tier, &name),
                aya: aya.contains(&(tier.clone(), name.clone())),
                protected: ctx.protected.contains(&(tier.clone(), name.clone())),
                qty,
                stacks,
                ev_plat,
                ducat_ev,
                drops_owned: base.drops_owned,
                drops_total: base.drops_total,
                drop_names,
                sets,
                wanted: wanted_count > 0,
                best_reward,
                best_reward_plat,
                rare_reward,
                rare_plat,
                score,
                tier,
                relic_name: name,
            });
        }
        out.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.display_name.cmp(&b.display_name))
        });
        Ok(out)
    })
}

/// Everything the relic drawer shows: per-refinement economics (EV, radshare odds,
/// refine-ROI vs Intact) and the full drop table with ownership. `aya` = currently
/// sold by Varzia for Aya.
pub fn detail(
    db: &Db,
    tier: &str,
    name: &str,
    sig: &CrackSignals,
    aya: bool,
    squad: u32,
) -> AppResult<RelicDetail> {
    if !relic::is_known(tier, name) {
        return Err(AppError::NotFound(format!("unknown relic: {tier} {name}")));
    }
    let name_to_slug = catalog::name_slug_map(db)?;
    db.read(|c| {
        let ctx = load_ctx(c, name_to_slug)?;
        let stacks = ctx
            .stacks
            .get(&(tier.to_string(), name.to_string()))
            .cloned()
            .unwrap_or_default();
        let owned_at = |r: &str| {
            stacks
                .iter()
                .filter(|s| s.refinement == r)
                .map(|s| s.qty)
                .sum::<i64>()
        };
        let mut refinements = Vec::new();
        let mut intact_ev: Option<f64> = None;
        for r in relic::REFINEMENTS {
            let Some(e) = eval_refinement(&ctx, tier, name, r, squad) else {
                continue; // Requiem relics may only have Intact — render what exists
            };
            if r == "Intact" {
                intact_ev = Some(e.ev_plat);
            }
            let trace_cost = TRACE_COSTS.iter().find(|(n, _)| *n == r).map(|&(_, c)| c);
            let (ev_delta, plat_per_100_traces) = match (trace_cost, intact_ev) {
                (Some(cost), Some(base)) => {
                    let d = e.ev_plat - base;
                    (Some(round1(d)), Some(round1(d / cost as f64 * 100.0)))
                }
                _ => (None, None),
            };
            refinements.push(RelicRefinementInfo {
                refinement: r.to_string(),
                owned_qty: owned_at(r),
                ev_plat: e.ev_plat,
                ev_solo: e.ev_solo,
                ducat_ev: e.ducat_ev,
                p_rare: e.p_rare,
                trace_cost,
                ev_delta,
                plat_per_100_traces,
            });
        }
        // Gold-tier rewards (for the drawer's rare highlight), from the base table.
        let rare = base_refinement(tier, name)
            .and_then(|br| relic::drops_for(tier, name, br))
            .map(|d| rare_names(&d))
            .unwrap_or_default();
        // Drop table: union rewards across refinements (chances vary per refinement).
        let mut order: Vec<String> = Vec::new();
        let mut by_reward: HashMap<String, Vec<RefinementChance>> = HashMap::new();
        for r in relic::REFINEMENTS {
            for d in &relic::drops_for(tier, name, r).unwrap_or_default() {
                let e = by_reward.entry(d.reward_name.clone()).or_insert_with(|| {
                    order.push(d.reward_name.clone());
                    Vec::new()
                });
                e.push(RefinementChance {
                    refinement: r.to_string(),
                    chance: d.chance,
                });
            }
        }
        let mut drops = Vec::with_capacity(order.len());
        for reward_name in order {
            let chances = by_reward.remove(&reward_name).unwrap_or_default();
            let slug = ctx
                .name_to_slug
                .get(&catalog::normalize_name(&reward_name))
                .cloned();
            let plat = slug
                .as_deref()
                .and_then(|s| prices::effective_price_from(&ctx.prices, s, None));
            let ducats = slug.as_deref().and_then(|s| ctx.ducats.get(s).copied());
            let owned_qty = slug
                .as_deref()
                .and_then(|s| ctx.owned_parts.get(s).copied())
                .unwrap_or(0);
            let wanted = slug.as_deref().is_some_and(|s| sig.watch_buy.contains(s));
            let one_away = slug.as_deref().and_then(|s| sig.one_away.get(s));
            drops.push(RelicDetailDrop {
                set: one_away.is_some(),
                set_slug: one_away.map(|(s, _)| s.clone()),
                rare: rare.contains(&reward_name),
                reward_name,
                reward_slug: slug,
                chances,
                plat,
                ducats,
                owned_qty,
                wanted,
            });
        }
        drops.sort_by_key(|d| std::cmp::Reverse(d.plat.unwrap_or(0)));
        Ok(RelicDetail {
            tier: tier.to_string(),
            relic_name: name.to_string(),
            display_name: display_name(tier, name),
            vaulted: relic::is_vaulted(tier, name),
            aya,
            protected: ctx
                .protected
                .contains(&(tier.to_string(), name.to_string())),
            squad_size: squad.max(1) as i64,
            stacks,
            refinements,
            drops,
        })
    })
}

/// Flip a relic's do-not-burn flag (kept per identity, so it covers every stack
/// and survives the owned qty hitting 0).
pub fn set_protected(db: &Db, tier: &str, name: &str, protected: bool) -> AppResult<()> {
    if !relic::is_known(tier, name) {
        return Err(AppError::NotFound(format!("unknown relic: {tier} {name}")));
    }
    db.with(|c| {
        if protected {
            c.execute(
                "INSERT INTO relic_prefs (tier, relic_name, protected) VALUES (?1, ?2, 1)
                 ON CONFLICT(tier, relic_name) DO UPDATE SET protected = 1",
                params![tier, name],
            )?;
        } else {
            c.execute(
                "DELETE FROM relic_prefs WHERE tier = ?1 AND relic_name = ?2",
                params![tier, name],
            )?;
        }
        Ok(())
    })
}

/// Relics that drop `slug` — the item Drawer's reverse lookup. Owned relics first,
/// then by Intact drop chance.
pub fn sources_for(db: &Db, slug: &str) -> AppResult<Vec<RelicSourceRow>> {
    let name_to_slug = catalog::name_slug_map(db)?;
    db.read(|c| {
        let mut owned: HashMap<(String, String), i64> = HashMap::new();
        let mut stmt = c.prepare(
            "SELECT tier, relic_name, SUM(qty) FROM owned_relics WHERE qty > 0
             GROUP BY tier, relic_name",
        )?;
        for row in stmt.query_map([], |r| {
            Ok((
                (r.get::<_, String>(0)?, r.get::<_, String>(1)?),
                r.get::<_, i64>(2)?,
            ))
        })? {
            let (key, qty) = row?;
            owned.insert(key, qty);
        }
        let chance_of = |tier: &str, name: &str, refinement: &str| -> Option<f64> {
            relic::drops_for(tier, name, refinement)?
                .iter()
                .find(|d| {
                    name_to_slug
                        .get(&catalog::normalize_name(&d.reward_name))
                        .is_some_and(|s| s == slug)
                })
                .map(|d| d.chance)
        };
        let mut out = Vec::new();
        for (tier, name) in relic::all_relics() {
            let chance_intact = chance_of(&tier, &name, "Intact");
            let chance_radiant = chance_of(&tier, &name, "Radiant");
            if chance_intact.is_none() && chance_radiant.is_none() {
                continue;
            }
            out.push(RelicSourceRow {
                display_name: display_name(&tier, &name),
                vaulted: relic::is_vaulted(&tier, &name),
                owned_qty: owned
                    .get(&(tier.clone(), name.clone()))
                    .copied()
                    .unwrap_or(0),
                chance_intact,
                chance_radiant,
                tier,
                relic_name: name,
            });
        }
        out.sort_by(|a, b| {
            (b.owned_qty > 0)
                .cmp(&(a.owned_qty > 0))
                .then_with(|| {
                    b.chance_intact
                        .unwrap_or(0.0)
                        .partial_cmp(&a.chance_intact.unwrap_or(0.0))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| a.display_name.cmp(&b.display_name))
        });
        Ok(out)
    })
}

fn norm_refinement(refinement: Option<&str>) -> AppResult<&'static str> {
    let r = refinement.unwrap_or("Intact");
    relic::REFINEMENTS
        .iter()
        .find(|x| x.eq_ignore_ascii_case(r))
        .copied()
        .ok_or_else(|| AppError::Invalid(format!("unknown refinement: {r}")))
}

/// Set the owned qty for a relic (0 removes it). Validates the relic is real —
/// the browser's drawer can "add" any catalog relic through this.
pub fn set_qty(
    db: &Db,
    tier: &str,
    name: &str,
    refinement: Option<&str>,
    qty: i64,
) -> AppResult<()> {
    if qty < 0 {
        return Err(AppError::Invalid("qty must be >= 0".into()));
    }
    if !relic::is_known(tier, name) {
        return Err(AppError::NotFound(format!("unknown relic: {tier} {name}")));
    }
    let refinement = norm_refinement(refinement)?;
    let now = Utc::now().to_rfc3339();
    db.with(|c| {
        if qty == 0 {
            c.execute(
                "DELETE FROM owned_relics WHERE tier=?1 AND relic_name=?2 AND refinement=?3",
                params![tier, name, refinement],
            )?;
            return Ok(());
        }
        c.execute(
            "INSERT INTO owned_relics
                (tier, relic_name, refinement, qty, source, first_added_at, last_modified_at)
             VALUES (?1, ?2, ?3, ?4, 'manual', ?5, ?5)
             ON CONFLICT(tier, relic_name, refinement) DO UPDATE SET
                qty = ?4, last_modified_at = ?5",
            params![tier, name, refinement, qty, now],
        )?;
        Ok(())
    })
}

/// Write scanned relics (game import): set each to its scanned qty with
/// source='de_scan'. Authoritative for the relics it sees; leaves others untouched
/// (so a partial scan can't silently wipe manual entries). Returns rows written.
pub fn apply_scan(db: &Db, items: &[(&str, &str, &str, i64)]) -> AppResult<usize> {
    let now = Utc::now().to_rfc3339();
    db.with_mut(|c| {
        let tx = c.transaction()?;
        let mut n = 0usize;
        for (tier, name, refinement, qty) in items {
            if *qty <= 0 {
                continue;
            }
            tx.execute(
                "INSERT INTO owned_relics
                    (tier, relic_name, refinement, qty, source, first_added_at, last_modified_at)
                 VALUES (?1, ?2, ?3, ?4, 'de_scan', ?5, ?5)
                 ON CONFLICT(tier, relic_name, refinement) DO UPDATE SET
                    qty = ?4, source = 'de_scan', last_modified_at = ?5",
                params![tier, name, refinement, qty, now],
            )?;
            n += 1;
        }
        tx.commit()?;
        Ok(n)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testutil::{seed_item, test_db};

    // Lith S1's bundled reward table (stable since 2016): 2X Forma Blueprint
    // (untradeable), Bronco/Hikou Prime Blueprints + Paris Prime String (commons),
    // Paris Prime Grip (uncommon), Spira Prime Pouch (the 2%→10% rare).
    const S1_SLUGS: [&str; 5] = [
        "bronco_prime_blueprint",
        "hikou_prime_blueprint",
        "paris_prime_grip",
        "paris_prime_string",
        "spira_prime_pouch",
    ];

    fn fixture() -> Db {
        let db = test_db("relics-browser");
        for (slug, plat) in S1_SLUGS.iter().zip([10, 20, 30, 4, 90]) {
            seed_item(&db, slug, "weapon", Some(plat));
        }
        db.with(|c| {
            for (slug, ducats) in S1_SLUGS.iter().zip([15, 45, 45, 15, 100]) {
                c.execute(
                    "UPDATE catalog_items SET ducats = ?2 WHERE slug = ?1",
                    params![slug, ducats],
                )?;
            }
            Ok(())
        })
        .unwrap();
        db
    }

    fn no_signals() -> CrackSignals {
        CrackSignals {
            watch_buy: HashSet::new(),
            one_away: HashMap::new(),
        }
    }

    fn s1_row(db: &Db, sig: &CrackSignals, squad: u32) -> RelicBrowserRow {
        browser_rows(db, sig, &HashSet::new(), squad)
            .unwrap()
            .into_iter()
            .find(|r| r.tier == "Lith" && r.relic_name == "S1")
            .expect("Lith S1 in browser")
    }

    // An unowned catalog row prices at Intact, and the squad-1 browser EV must equal
    // the per-drop SQL effective_price sum (the twin invariant `value_relic` used to pin).
    #[test]
    fn unowned_row_is_intact_ev_and_matches_sql() {
        let db = fixture();
        let row = s1_row(&db, &no_signals(), 1);
        assert_eq!(row.qty, 0);
        assert!(row.stacks.is_empty());
        let expected: f64 = db
            .read(|c| {
                let mut ev = 0.0;
                for d in &relic::drops_for("Lith", "S1", "Intact").unwrap() {
                    let slug = catalog::normalize_name(&d.reward_name).replace(' ', "_");
                    if let Some(p) = prices::effective_price(c, &slug, None)? {
                        ev += d.chance / 100.0 * p as f64;
                    }
                }
                Ok(ev)
            })
            .unwrap();
        assert!((row.ev_plat - round1(expected)).abs() < 1e-9);
        assert!(row.ev_plat > 0.0);
    }

    // Row EV over owned stacks is the qty-weighted mean of the stack refinements'
    // EVs (cross-checked against the drawer's per-refinement numbers).
    #[test]
    fn owned_mix_is_qty_weighted_across_refinements() {
        let db = fixture();
        set_qty(&db, "Lith", "S1", Some("Intact"), 3).unwrap();
        set_qty(&db, "Lith", "S1", Some("Radiant"), 1).unwrap();
        let sig = no_signals();
        let det = detail(&db, "Lith", "S1", &sig, false, 1).unwrap();
        let ev_of = |r: &str| {
            det.refinements
                .iter()
                .find(|x| x.refinement == r)
                .unwrap()
                .ev_plat
        };
        let row = s1_row(&db, &sig, 1);
        assert_eq!(row.qty, 4);
        assert_eq!(row.stacks.len(), 2);
        let expected = round1((3.0 * ev_of("Intact") + ev_of("Radiant")) / 4.0);
        assert!((row.ev_plat - expected).abs() < 1e-9);
        // Radiant EV must beat Intact here (the 90p rare goes 2% → 10%).
        assert!(ev_of("Radiant") > ev_of("Intact"));
    }

    // Ducat EV is linear over catalog ducat values; untradeable rewards contribute 0.
    #[test]
    fn ducat_ev_is_linear_over_catalog_ducats() {
        let db = fixture();
        let row = s1_row(&db, &no_signals(), 1);
        let ducat_of = |name: &str| -> f64 {
            match catalog::normalize_name(name).replace(' ', "_").as_str() {
                "bronco_prime_blueprint" | "paris_prime_string" => 15.0,
                "hikou_prime_blueprint" | "paris_prime_grip" => 45.0,
                "spira_prime_pouch" => 100.0,
                _ => 0.0, // 2X Forma Blueprint
            }
        };
        let expected: f64 = relic::drops_for("Lith", "S1", "Intact")
            .unwrap()
            .iter()
            .map(|d| d.chance / 100.0 * ducat_of(&d.reward_name))
            .sum();
        assert!((row.ducat_ev - round1(expected)).abs() < 1e-9);
    }

    // n/m ownership counts cover slug-resolvable rewards only — Forma never makes
    // the count unreachable.
    #[test]
    fn drops_owned_counts_resolvable_rewards_only() {
        let db = fixture();
        db.with(|c| {
            c.execute(
                "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at) VALUES
                    ('bronco_prime_blueprint', 2, '2026-01-01', '2026-01-01'),
                    ('spira_prime_pouch', 1, '2026-01-01', '2026-01-01')",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        let row = s1_row(&db, &no_signals(), 1);
        assert_eq!(row.drops_total, 5, "Forma must not count as a drop slot");
        assert_eq!(row.drops_owned, 2);
        assert_eq!(row.drop_names.len(), 6, "search haystack keeps all rewards");
    }

    // The gold-tier drop: the lowest-chance reward, priced separately; flat tables
    // (Requiem Eterna) have no rarity tiers and no rare.
    #[test]
    fn rare_drop_is_the_lowest_chance_reward() {
        let db = fixture();
        let row = s1_row(&db, &no_signals(), 1);
        assert_eq!(row.rare_reward.as_deref(), Some("Spira Prime Pouch"));
        assert_eq!(row.rare_plat, Some(90));

        let eterna = browser_rows(&db, &no_signals(), &HashSet::new(), 1)
            .unwrap()
            .into_iter()
            .find(|r| r.tier == "Requiem" && r.relic_name == "ETERNA")
            .unwrap();
        assert_eq!(eterna.rare_reward, None);
        assert_eq!(eterna.rare_plat, None);

        let det = detail(&db, "Lith", "S1", &no_signals(), false, 1).unwrap();
        let rare_flags: Vec<_> = det.drops.iter().filter(|d| d.rare).collect();
        assert_eq!(rare_flags.len(), 1);
        assert_eq!(rare_flags[0].reward_name, "Spira Prime Pouch");
    }

    // Varzia's current Resurgence stock marks matching identities as aya-buyable.
    #[test]
    fn aya_set_marks_matching_rows() {
        let db = fixture();
        let aya = HashSet::from([("Lith".to_string(), "S1".to_string())]);
        let rows = browser_rows(&db, &no_signals(), &aya, 1).unwrap();
        let s1 = rows
            .iter()
            .find(|r| r.tier == "Lith" && r.relic_name == "S1")
            .unwrap();
        assert!(s1.aya);
        assert!(rows.iter().filter(|r| r.aya).count() == 1);
        let det = detail(&db, "Lith", "S1", &no_signals(), true, 1).unwrap();
        assert!(det.aya);
    }

    // The do-not-burn flag lives on the identity: it survives the stack going to 0.
    #[test]
    fn protected_survives_qty_zero() {
        let db = fixture();
        set_protected(&db, "Lith", "S1", true).unwrap();
        set_qty(&db, "Lith", "S1", Some("Intact"), 2).unwrap();
        set_qty(&db, "Lith", "S1", Some("Intact"), 0).unwrap();
        let row = s1_row(&db, &no_signals(), 1);
        assert_eq!(row.qty, 0);
        assert!(row.protected);
        set_protected(&db, "Lith", "S1", false).unwrap();
        assert!(!s1_row(&db, &no_signals(), 1).protected);
        assert!(set_protected(&db, "Lith", "NOPE", true).is_err());
    }

    // Categorical signals dwarf EV in the burn score, in the fixed order
    // set > wanted > now, and the one-away set backlink surfaces.
    #[test]
    fn score_orders_set_over_wanted_over_now_over_ev() {
        let db = fixture();
        let mut sig = no_signals();
        sig.one_away.insert(
            "spira_prime_pouch".into(),
            ("spira_prime_set".into(), "Spira Prime Set".into()),
        );
        let row = s1_row(&db, &sig, 1);
        assert!(row.score >= W_SET);
        assert_eq!(row.sets.len(), 1);
        assert_eq!(row.sets[0].name, "Spira Prime Set");

        let mut sig = no_signals();
        sig.watch_buy.insert("spira_prime_pouch".into());
        let wanted_row = s1_row(&db, &sig, 1);
        assert!(wanted_row.wanted);
        assert!(wanted_row.score >= W_WANTED && wanted_row.score < W_SET);
    }

    // The drawer's refine-ROI: trace costs are cumulative from Intact and the
    // deltas are EV-vs-Intact at the same squad size.
    #[test]
    fn detail_roi_is_ev_delta_vs_intact_over_trace_cost() {
        let db = fixture();
        let det = detail(&db, "Lith", "S1", &no_signals(), false, 1).unwrap();
        assert_eq!(det.refinements.len(), 4);
        let intact = &det.refinements[0];
        assert_eq!(intact.refinement, "Intact");
        assert_eq!(intact.trace_cost, None);
        assert_eq!(intact.ev_delta, None);
        let radiant = det
            .refinements
            .iter()
            .find(|r| r.refinement == "Radiant")
            .unwrap();
        assert_eq!(radiant.trace_cost, Some(100));
        let delta = radiant.ev_delta.unwrap();
        assert!((delta - round1(radiant.ev_plat - intact.ev_plat)).abs() < 1e-9);
        // 100 traces → plat/100tr equals the delta itself.
        assert!((radiant.plat_per_100_traces.unwrap() - round1(delta)).abs() < 1e-9);
        // Radshare: solo Radiant rare odds are 10%.
        let det4 = detail(&db, "Lith", "S1", &no_signals(), false, 4).unwrap();
        let rad4 = det4
            .refinements
            .iter()
            .find(|r| r.refinement == "Radiant")
            .unwrap();
        assert!((rad4.p_rare - 0.3439).abs() < 1e-4);
        assert!(rad4.ev_plat >= radiant.ev_plat);
    }

    // 2026's Requiem Eterna has an Intact-only, 8-reward, Σ=76% table — the code
    // must render what exists instead of assuming four refinements.
    #[test]
    fn requiem_eterna_renders_without_all_refinements() {
        let db = fixture();
        let det = detail(&db, "Requiem", "ETERNA", &no_signals(), false, 4).unwrap();
        assert_eq!(det.refinements.len(), 1);
        assert_eq!(det.refinements[0].refinement, "Intact");
        assert_eq!(det.drops.len(), 8);
        let row = browser_rows(&db, &no_signals(), &HashSet::new(), 4)
            .unwrap()
            .into_iter()
            .find(|r| r.tier == "Requiem" && r.relic_name == "ETERNA")
            .expect("Eterna in browser");
        assert_eq!(row.drops_total, 0, "Requiem mods aren't tradeable");
        assert!(row.ev_plat.is_finite());
    }

    // Live-DB spot check (CLAUDE.md: pricing bugs are usually data/integration
    // issues invisible to unit tests). Point WFIT_LIVE_DB at a COPY of the real
    // database — opening it migrates the file, which would strand an older
    // installed binary — and compare the printed EVs against a SQL hand-sum.
    //   WFIT_LIVE_DB=/tmp/copy.sqlite cargo test live_db -- --ignored --nocapture
    #[test]
    #[ignore = "needs WFIT_LIVE_DB pointing at a COPY of the real database"]
    fn live_db_spot_check() {
        let Some(path) = std::env::var_os("WFIT_LIVE_DB") else {
            return;
        };
        let db = Db::open(std::path::Path::new(&path)).unwrap();
        let rows = browser_rows(&db, &no_signals(), &HashSet::new(), 1).unwrap();
        let owned: Vec<_> = rows.iter().filter(|r| r.qty > 0).collect();
        println!("{} catalog relics, {} owned", rows.len(), owned.len());
        assert!(rows.len() > 500, "expected the full relic catalog");
        for r in &owned {
            println!(
                "{:<12} qty {:>3}  ev {:>7.1}p  duc {:>6.1}  drops {}/{}  vaulted {}  rare {:?} {:?}",
                r.display_name,
                r.qty,
                r.ev_plat,
                r.ducat_ev,
                r.drops_owned,
                r.drops_total,
                r.vaulted,
                r.rare_reward,
                r.rare_plat
            );
        }
    }

    // Companion to the spot check: exercise the WFCD relic refresh (the same path
    // the launch TTL gate and "Update game data" call) against a DB copy, then
    // report the vault split — catches a stale bundled snapshot marking the
    // currently-farmable relics as vaulted.
    #[tokio::test]
    #[ignore = "network; needs WFIT_LIVE_DB pointing at a COPY of the real database"]
    async fn live_db_refresh_from_wfcd() {
        let Some(path) = std::env::var_os("WFIT_LIVE_DB") else {
            return;
        };
        let db = Db::open(std::path::Path::new(&path)).unwrap();
        let ok = crate::db::relic_data::refresh(&db).await.unwrap();
        assert!(ok, "WFCD Relics.json fetch failed");
        let (total, unvaulted) = db
            .read(|c| {
                Ok((
                    c.query_row("SELECT COUNT(*) FROM relic_vaults", [], |r| {
                        r.get::<_, i64>(0)
                    })?,
                    c.query_row(
                        "SELECT COUNT(*) FROM relic_vaults WHERE vaulted = 0",
                        [],
                        |r| r.get::<_, i64>(0),
                    )?,
                ))
            })
            .unwrap();
        println!("after WFCD refresh: {total} relics, {unvaulted} unvaulted");
        assert!(
            unvaulted > 0,
            "every relic vaulted after refresh — data bug"
        );
    }

    // Reverse lookup: the rare's chance shifts 2% → 10% Intact → Radiant.
    #[test]
    fn sources_for_finds_the_dropping_relic() {
        let db = fixture();
        set_qty(&db, "Lith", "S1", Some("Intact"), 2).unwrap();
        let sources = sources_for(&db, "spira_prime_pouch").unwrap();
        let s1 = sources
            .iter()
            .find(|s| s.tier == "Lith" && s.relic_name == "S1")
            .expect("Lith S1 drops Spira Prime Pouch");
        assert_eq!(s1.owned_qty, 2);
        assert!((s1.chance_intact.unwrap() - 2.0).abs() < 1e-9);
        assert!((s1.chance_radiant.unwrap() - 10.0).abs() < 1e-9);
        // Owned relics sort first.
        assert!(sources[0].owned_qty > 0);
        assert!(sources_for(&db, "not_a_real_slug").unwrap().is_empty());
    }
}
