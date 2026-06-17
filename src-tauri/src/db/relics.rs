//! Owned void relics: storage + drop-based valuation. Relics aren't traded on
//! warframe.market, so a relic's worth is the expected plat of what it can drop —
//! Σ (drop chance × the drop's market price), reusing `prices::effective_price` and
//! resolving drop display names to catalog slugs via `catalog::name_slug_map`.
//! Unpriceable drops (Forma, Kuva, Requiem mods) simply contribute nothing.

use crate::db::wanted::CrackSignals;
use crate::db::{catalog, prices, Db};
use crate::domain::relic;
use crate::error::{AppError, AppResult};
use crate::types::{CrackDrop, CrackNowRow, CrackPlanRow, CrackSet, RelicChoice, RelicRow};
use chrono::Utc;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};

fn display_name(tier: &str, name: &str) -> String {
    format!("{tier} {name}")
}

/// Memoized `effective_price` (non-ranked) for a drop slug.
fn price_of(
    c: &Connection,
    cache: &mut HashMap<String, Option<i64>>,
    slug: &str,
) -> AppResult<Option<i64>> {
    if let Some(v) = cache.get(slug) {
        return Ok(*v);
    }
    let v = prices::effective_price(c, slug, None)?;
    cache.insert(slug.to_string(), v);
    Ok(v)
}

/// Computed worth of one relic at a refinement.
struct RelicValue {
    ev_plat: f64,
    best_reward: Option<String>,
    best_reward_plat: Option<i64>,
    priced_drops: i64,
    total_drops: i64,
}

fn value_relic(
    c: &Connection,
    name_to_slug: &HashMap<String, String>,
    price_cache: &mut HashMap<String, Option<i64>>,
    tier: &str,
    name: &str,
    refinement: &str,
) -> AppResult<RelicValue> {
    let drops = relic::drops_for(tier, name, refinement).unwrap_or_default();
    let mut ev = 0.0;
    let mut priced = 0i64;
    let mut best: Option<(String, i64)> = None;
    for d in &drops {
        let Some(slug) = name_to_slug.get(&catalog::normalize_name(&d.reward_name)) else {
            continue; // Forma/Kuva/etc. — not a tradeable catalog item
        };
        if let Some(p) = price_of(c, price_cache, slug)? {
            ev += (d.chance / 100.0) * p as f64;
            priced += 1;
            if best.as_ref().map(|(_, bp)| p > *bp).unwrap_or(true) {
                best = Some((d.reward_name.clone(), p));
            }
        }
    }
    let (best_reward, best_reward_plat) = match best {
        Some((n, p)) => (Some(n), Some(p)),
        None => (None, None),
    };
    Ok(RelicValue {
        ev_plat: (ev * 10.0).round() / 10.0,
        best_reward,
        best_reward_plat,
        priced_drops: priced,
        total_drops: drops.len() as i64,
    })
}

/// Owned relics valued by drop EV, richest stack first.
pub fn owned_relics(db: &Db) -> AppResult<Vec<RelicRow>> {
    let name_to_slug = catalog::name_slug_map(db)?;
    db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT tier, relic_name, refinement, qty, source, first_added_at
             FROM owned_relics WHERE qty > 0",
        )?;
        let raw = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut price_cache: HashMap<String, Option<i64>> = HashMap::new();
        let mut out = Vec::with_capacity(raw.len());
        for (tier, relic_name, refinement, qty, source, first_added_at) in raw {
            let v = value_relic(
                c,
                &name_to_slug,
                &mut price_cache,
                &tier,
                &relic_name,
                &refinement,
            )?;
            out.push(RelicRow {
                display_name: display_name(&tier, &relic_name),
                relic_vaulted: relic::is_vaulted(&tier, &relic_name),
                tier,
                relic_name,
                refinement,
                qty,
                ev_plat: v.ev_plat,
                best_reward: v.best_reward,
                best_reward_plat: v.best_reward_plat,
                priced_drops: v.priced_drops,
                total_drops: v.total_drops,
                source,
                first_added_at,
            });
        }
        out.sort_by(|a, b| {
            (b.ev_plat * b.qty as f64)
                .partial_cmp(&(a.ev_plat * a.qty as f64))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.display_name.cmp(&b.display_name))
        });
        Ok(out)
    })
}

/// Owned relics that can drop a wanted item, each flagged with whether a live
/// fissure can crack it right now. `live_tiers` = fissure tiers currently active;
/// `wanted` = wanted slugs (watch/buy list + near-complete set parts, see
/// [`wanted::crack_targets`]). Only relics with ≥1 wanted drop are returned;
/// crackable-now relics sort first, so the actionable ones lead.
///
/// [`wanted::crack_targets`]: crate::db::wanted::crack_targets
pub fn crack_now(
    db: &Db,
    live_tiers: &HashSet<String>,
    wanted: &HashSet<String>,
) -> AppResult<Vec<CrackNowRow>> {
    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    let name_to_slug = catalog::name_slug_map(db)?;
    db.read(|c| {
        let mut stmt =
            c.prepare("SELECT tier, relic_name, refinement, qty FROM owned_relics WHERE qty > 0")?;
        let raw = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut price_cache: HashMap<String, Option<i64>> = HashMap::new();
        let mut out = Vec::new();
        for (tier, relic_name, refinement, qty) in raw {
            // Wanted drops: reward names whose resolved slug is in the wanted set.
            let drops = relic::drops_for(&tier, &relic_name, &refinement).unwrap_or_default();
            let mut wanted_drops = Vec::new();
            for d in &drops {
                if let Some(slug) = name_to_slug.get(&catalog::normalize_name(&d.reward_name)) {
                    if wanted.contains(slug) {
                        wanted_drops.push(d.reward_name.clone());
                    }
                }
            }
            if wanted_drops.is_empty() {
                continue; // nothing you want in here — keep it off the tab
            }
            let v = value_relic(
                c,
                &name_to_slug,
                &mut price_cache,
                &tier,
                &relic_name,
                &refinement,
            )?;
            out.push(CrackNowRow {
                crackable_now: live_tiers.contains(&tier),
                display_name: display_name(&tier, &relic_name),
                tier,
                relic_name,
                refinement,
                qty,
                ev_plat: v.ev_plat,
                wanted_drops,
            });
        }
        // Crackable-now first (actionable), then more-wanted, then by EV.
        out.sort_by(|a, b| {
            b.crackable_now
                .cmp(&a.crackable_now)
                .then_with(|| b.wanted_drops.len().cmp(&a.wanted_drops.len()))
                .then_with(|| {
                    (b.ev_plat * b.qty as f64)
                        .partial_cmp(&(a.ev_plat * a.qty as f64))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
        });
        Ok(out)
    })
}

/// Combined-priority weights for the "To crack" planner. Each tier dwarfs the next so
/// the categorical signals strictly order relics and EV only breaks ties: completes a
/// one-away set → drops a watch/buy-list item → crackable now → expected value. Vaulted
/// is NOT a factor (it's a display tag only). Tunable.
const W_SET: f64 = 1_000_000.0; // × count of one-away set parts dropped
const W_WANTED: f64 = 100_000.0; // × min(count, 3)
const W_NOW: f64 = 10_000.0;
/// A relic with no set/wanted drop still earns a spot if it returns at least this much
/// plat per crack (the "high value" inclusion bar).
const MIN_EV_PLAT: f64 = 15.0;

/// Owned relics worth cracking, ranked by a combined priority [`score`]. A relic is
/// included if it drops a part that completes a **one-away** set (`sig.one_away`), drops
/// a watch/buy-list item (`sig.watch_buy`), or returns at least [`MIN_EV_PLAT`] per crack.
/// `relic_vaulted` is carried as a display tag only — it never lists or ranks a relic.
/// `live_tiers` flags whether a fissure can crack it now; `drops` is the full reward
/// table and `sets` the one-away sets for the UI backlinks. Powers the "To crack" tab.
///
/// [`score`]: crate::types::CrackPlanRow::score
pub fn crack_plan(
    db: &Db,
    live_tiers: &HashSet<String>,
    sig: &CrackSignals,
) -> AppResult<Vec<CrackPlanRow>> {
    let name_to_slug = catalog::name_slug_map(db)?;
    db.read(|c| {
        let mut stmt =
            c.prepare("SELECT tier, relic_name, refinement, qty FROM owned_relics WHERE qty > 0")?;
        let raw = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut price_cache: HashMap<String, Option<i64>> = HashMap::new();
        let mut out = Vec::new();
        for (tier, relic_name, refinement, qty) in raw {
            let mut drops = Vec::new();
            let mut sets: Vec<CrackSet> = Vec::new();
            let mut ev = 0.0;
            let (mut set_count, mut wanted_count) = (0i64, 0i64);
            for d in &relic::drops_for(&tier, &relic_name, &refinement).unwrap_or_default() {
                let slug = name_to_slug.get(&catalog::normalize_name(&d.reward_name));
                let plat = match slug {
                    Some(s) => price_of(c, &mut price_cache, s)?,
                    None => None,
                };
                if let Some(p) = plat {
                    ev += (d.chance / 100.0) * p as f64;
                }
                let wanted = slug.is_some_and(|s| sig.watch_buy.contains(s));
                let one_away = slug.and_then(|s| sig.one_away.get(s));
                let set = one_away.is_some();
                if wanted {
                    wanted_count += 1;
                }
                if let Some((set_slug, set_name)) = one_away {
                    set_count += 1;
                    if !sets.iter().any(|s| &s.slug == set_slug) {
                        sets.push(CrackSet {
                            slug: set_slug.clone(),
                            name: set_name.clone(),
                        });
                    }
                }
                drops.push(CrackDrop {
                    reward_name: d.reward_name.clone(),
                    chance: d.chance,
                    plat,
                    wanted,
                    set,
                    reward_slug: slug.cloned(),
                    set_slug: one_away.map(|(s, _)| s.clone()),
                });
            }
            let ev_plat = (ev * 10.0).round() / 10.0;
            if set_count == 0 && wanted_count == 0 && ev_plat < MIN_EV_PLAT {
                continue; // not worth surfacing
            }
            let relic_vaulted = relic::is_vaulted(&tier, &relic_name);
            let crackable_now = live_tiers.contains(&tier);
            // Best-value drops first, so the expanded table leads with what matters.
            drops.sort_by_key(|d| std::cmp::Reverse(d.plat.unwrap_or(0)));
            let score = W_SET * set_count as f64
                + W_WANTED * (wanted_count.min(3) as f64)
                + W_NOW * (crackable_now as i64 as f64)
                + ev_plat;
            out.push(CrackPlanRow {
                display_name: display_name(&tier, &relic_name),
                tier,
                relic_name,
                refinement,
                qty,
                ev_plat,
                relic_vaulted,
                crackable_now,
                drops,
                sets,
                score,
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

/// Every known relic, for the manual-add picker.
pub fn list_choices() -> Vec<RelicChoice> {
    relic::all_relics()
        .into_iter()
        .map(|(tier, name)| RelicChoice {
            display_name: display_name(&tier, &name),
            tier,
            relic_name: name,
        })
        .collect()
}

fn norm_refinement(refinement: Option<&str>) -> AppResult<&'static str> {
    let r = refinement.unwrap_or("Intact");
    relic::REFINEMENTS
        .iter()
        .find(|x| x.eq_ignore_ascii_case(r))
        .copied()
        .ok_or_else(|| AppError::Invalid(format!("unknown refinement: {r}")))
}

/// Add `qty` of a relic (manual). Validates the relic is real; refinement defaults
/// to Intact (how relics are owned before cracking).
pub fn add(db: &Db, tier: &str, name: &str, refinement: Option<&str>, qty: i64) -> AppResult<()> {
    if qty <= 0 {
        return Err(AppError::Invalid("qty must be > 0".into()));
    }
    if !relic::is_known(tier, name) {
        return Err(AppError::NotFound(format!("unknown relic: {tier} {name}")));
    }
    let refinement = norm_refinement(refinement)?;
    let now = Utc::now().to_rfc3339();
    db.with(|c| {
        c.execute(
            "INSERT INTO owned_relics
                (tier, relic_name, refinement, qty, source, first_added_at, last_modified_at)
             VALUES (?1, ?2, ?3, ?4, 'manual', ?5, ?5)
             ON CONFLICT(tier, relic_name, refinement) DO UPDATE SET
                qty = qty + ?4, last_modified_at = ?5",
            params![tier, name, refinement, qty, now],
        )?;
        Ok(())
    })
}

/// Set the owned qty for a relic (0 removes it).
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

/// Remove a relic stack entirely.
pub fn remove(db: &Db, tier: &str, name: &str, refinement: Option<&str>) -> AppResult<()> {
    let refinement = norm_refinement(refinement)?;
    db.with(|c| {
        c.execute(
            "DELETE FROM owned_relics WHERE tier=?1 AND relic_name=?2 AND refinement=?3",
            params![tier, name, refinement],
        )?;
        Ok(())
    })
}
