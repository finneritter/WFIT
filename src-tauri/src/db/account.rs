//! Account data: the `item_manifest` reference table (non-tradeable name/icon/mastery,
//! the Codex denominator) plus — added in later phases — the scanned account snapshot.
//!
//! The manifest follows the `db::relic_data` pattern exactly: a bundled TSV seeds the
//! table (re-seeded when the bundle version bumps), and "Update game data" refreshes it
//! from the live WFCD `warframe-items` JSON. Everything here is a rebuildable cache.
use crate::db::{meta, Db};
use crate::domain::mastery;
use crate::error::AppResult;
use crate::gamescan::account::AccountSnapshot;
use crate::types::{
    AccountProfile, CodexCategory, CodexData, GearRow, IntrinsicRow, LoreScanRow, ResourceRow,
    SyndicateRow,
};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Deserialize;
use std::collections::HashMap;

/// Bundled manifest baseline. Bump when `data/item_manifest.tsv` is regenerated so an
/// app update re-seeds the table even if the user never hits "Update game data".
const ITEM_MANIFEST_BUNDLE_VERSION: &str = "1";
const BUNDLED_MANIFEST: &str = include_str!("data/item_manifest.tsv");

/// WFCD category files that carry masterable GEAR (productCategory == DE array name).
const WFCD_GEAR_FILES: &[&str] = &[
    "Warframes",
    "Primary",
    "Secondary",
    "Melee",
    "Archwing",
    "Arch-Gun",
    "Arch-Melee",
    "Sentinels",
    "SentinelWeapons",
    "Pets",
];
/// WFCD files that carry resources/components (no productCategory; category "Resources").
const WFCD_RESOURCE_FILES: &[&str] = &["Resources", "Misc", "Gear"];
const WFCD_BASE: &str = "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/";

/// A manifest row: DE `unique_name` → display/category/icon/mastery facts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestRow {
    pub unique_name: String,
    pub display_name: String,
    pub category: String,
    pub icon_path: Option<String>,
    pub max_rank: Option<i64>,
    pub mastery_req: Option<i64>,
}

/// DE `productCategory` (== the inventory array name) → our normalized category. Mirrors
/// the gamescan array→category mapping so manifest and scanned gear agree.
fn category_for(product_category: &str) -> Option<&'static str> {
    Some(match product_category {
        "Suits" => "warframe",
        "MechSuits" => "necramech",
        "LongGuns" => "primary",
        "Pistols" => "secondary",
        "Melee" => "melee",
        "SpaceSuits" | "SpaceGuns" | "SpaceMelee" => "archwing",
        "Sentinels" | "SentinelWeapons" | "KubrowPets" | "MoaPets" => "companion",
        "OperatorAmps" => "amp",
        "SpecialItems" => "special",
        "CrewShipWeapons" => "railjack",
        _ => return None,
    })
}

/// Best-effort gear max rank: 40 for Necramechs, Kuva/Tenet/Paracesis; 30 otherwise.
fn max_rank_for(name: &str, category: &str) -> i64 {
    if category == "necramech" {
        return 40;
    }
    let n = name.to_ascii_lowercase();
    if n.starts_with("kuva ") || n.starts_with("tenet ") || n.starts_with("paracesis") {
        40
    } else {
        30
    }
}

#[derive(Deserialize)]
struct WfItem {
    name: Option<String>,
    #[serde(rename = "uniqueName")]
    unique_name: Option<String>,
    #[serde(rename = "imageName")]
    image_name: Option<String>,
    #[serde(rename = "masteryReq")]
    mastery_req: Option<i64>,
    #[serde(rename = "productCategory")]
    product_category: Option<String>,
    #[serde(default)]
    masterable: bool,
}

/// Parse the bundled TSV into rows (the seed baseline).
fn bundled_rows() -> Vec<ManifestRow> {
    BUNDLED_MANIFEST
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let mut f = line.split('\t');
            let unique_name = f.next()?.to_string();
            let display_name = f.next()?.to_string();
            let category = f.next()?.to_string();
            let icon = f.next().unwrap_or("");
            let max_rank = f.next().unwrap_or("");
            let mastery_req = f.next().unwrap_or("");
            Some(ManifestRow {
                unique_name,
                display_name,
                category,
                icon_path: (!icon.is_empty()).then(|| icon.to_string()),
                max_rank: max_rank.parse().ok(),
                mastery_req: mastery_req.parse().ok(),
            })
        })
        .collect()
}

/// Fetch + parse the WFCD category files into manifest rows (the live refresh source).
/// Applies the SAME category/max_rank logic as the bundled-TSV generator.
async fn fetch_remote() -> AppResult<Vec<ManifestRow>> {
    let http = reqwest::Client::builder()
        .user_agent(crate::USER_AGENT)
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let mut rows: Vec<ManifestRow> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let fetch = |file: &str| {
        let http = http.clone();
        let url = format!("{WFCD_BASE}{file}.json");
        async move {
            http.get(url)
                .send()
                .await?
                .error_for_status()?
                .json::<Vec<WfItem>>()
                .await
                .map_err(crate::error::AppError::from)
        }
    };

    for file in WFCD_GEAR_FILES {
        let items = fetch(file).await?;
        for it in items {
            if !it.masterable {
                continue;
            }
            let (Some(un), Some(name), Some(pc)) =
                (it.unique_name, it.name, it.product_category.as_deref())
            else {
                continue;
            };
            let Some(cat) = category_for(pc) else {
                continue;
            };
            if !seen.insert(un.clone()) {
                continue;
            }
            let max_rank = max_rank_for(&name, cat);
            rows.push(ManifestRow {
                unique_name: un,
                display_name: name,
                category: cat.to_string(),
                icon_path: it.image_name,
                max_rank: Some(max_rank),
                mastery_req: it.mastery_req,
            });
        }
    }
    for file in WFCD_RESOURCE_FILES {
        let items = fetch(file).await?;
        for it in items {
            // Gear entries that live in Misc are owned by the gear files above.
            if it
                .product_category
                .as_deref()
                .is_some_and(|pc| category_for(pc).is_some())
            {
                continue;
            }
            let (Some(un), Some(name)) = (it.unique_name, it.name) else {
                continue;
            };
            if !seen.insert(un.clone()) {
                continue;
            }
            rows.push(ManifestRow {
                unique_name: un,
                display_name: name,
                category: "resource".to_string(),
                icon_path: it.image_name,
                max_rank: None,
                mastery_req: None,
            });
        }
    }
    Ok(rows)
}

/// Replace the whole item_manifest table in one transaction.
fn store(db: &Db, rows: &[ManifestRow]) -> AppResult<()> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM item_manifest", [])?;
        {
            let mut s = tx.prepare(
                "INSERT OR REPLACE INTO item_manifest
                    (unique_name, display_name, category, icon_path, max_rank, mastery_req)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            for r in rows {
                s.execute(params![
                    r.unique_name,
                    r.display_name,
                    r.category,
                    r.icon_path,
                    r.max_rank,
                    r.mastery_req
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

fn is_empty(db: &Db) -> AppResult<bool> {
    db.with(|c| {
        let n: i64 = c.query_row("SELECT COUNT(*) FROM item_manifest", [], |r| r.get(0))?;
        Ok(n == 0)
    })
}

/// Total manifest rows — for "+N items" update deltas.
pub fn manifest_count(db: &Db) -> AppResult<i64> {
    db.with(|c| {
        let n: i64 = c.query_row("SELECT COUNT(*) FROM item_manifest", [], |r| r.get(0))?;
        Ok(n)
    })
}

/// Seed item_manifest from the bundled TSV when empty or when the bundle version
/// changed (an app update shipped a newer baseline). No network.
pub fn seed_if_empty_or_stale(db: &Db) -> AppResult<()> {
    let stale = meta::get(db, meta::KEY_ITEM_MANIFEST_BUNDLE_VERSION)?.as_deref()
        != Some(ITEM_MANIFEST_BUNDLE_VERSION);
    if is_empty(db)? || stale {
        let rows = bundled_rows();
        store(db, &rows)?;
        meta::set(
            db,
            meta::KEY_ITEM_MANIFEST_BUNDLE_VERSION,
            ITEM_MANIFEST_BUNDLE_VERSION,
        )?;
        tracing::info!(n = rows.len(), "item_manifest seeded from bundled snapshot");
    }
    Ok(())
}

/// Force a refresh from live WFCD. Replaces the table on success; keeps existing data
/// on failure. Returns whether the network fetch succeeded.
pub async fn refresh_manifest(db: &Db) -> AppResult<bool> {
    match fetch_remote().await {
        Ok(rows) if !rows.is_empty() => {
            store(db, &rows)?;
            meta::set(db, meta::KEY_LAST_MANIFEST_SYNC, &Utc::now().to_rfc3339())?;
            tracing::info!(n = rows.len(), "item_manifest refreshed from WFCD");
            Ok(true)
        }
        result => {
            tracing::warn!(
                ok = result.is_ok(),
                "item_manifest refresh failed; keeping existing data"
            );
            Ok(false)
        }
    }
}

// ===========================================================================
// Snapshot persistence: the account_* tables are rebuilt wholesale each scan.
// ===========================================================================

/// CDN icon URL from a WFCD imageName (same image family as catalog thumbnails).
fn cdn_icon(icon_path: Option<String>) -> Option<String> {
    icon_path.map(|p| format!("https://cdn.warframestat.us/img/{p}"))
}

/// Best-effort display name from a DE uniqueName: the last path segment, with
/// PascalCase split into words. Used only when neither catalog nor manifest resolves.
fn name_from_path(unique_name: &str) -> String {
    let seg = unique_name.rsplit('/').next().unwrap_or(unique_name);
    let mut out = String::new();
    let mut prev_lower = false;
    for ch in seg.chars() {
        if ch.is_uppercase() && prev_lower {
            out.push(' ');
        }
        out.push(ch);
        prev_lower = ch.is_lowercase() || ch.is_numeric();
    }
    out
}

/// Friendly syndicate name from a DE Tag (best-effort; falls back to de-camelCasing).
fn syndicate_label(tag: &str) -> String {
    let known = match tag {
        "NewLokaSyndicate" => "New Loka",
        "CephalonSudaSyndicate" => "Cephalon Suda",
        "ArbitersSyndicate" => "Arbiters of Hexis",
        "SteelMeridianSyndicate" => "Steel Meridian",
        "PerrinSyndicate" => "The Perrin Sequence",
        "RedVeilSyndicate" => "Red Veil",
        "EventSyndicate" => "Nightwave",
        "CephalonSimarisSyndicate" => "Cephalon Simaris",
        "QuillsSyndicate" => "The Quills",
        "SolarisSyndicate" => "Solaris United",
        "OstronSyndicate" => "Ostron",
        "EntratiSyndicate" => "Entrati",
        "NecraloidSyndicate" => "Necraloid",
        "VentkidsSyndicate" => "Ventkids",
        "VoxSyndicate" => "Vox Solaris",
        "ZarimanSyndicate" => "The Holdfasts",
        "KahlSyndicate" => "Kahl's Garrison",
        "CaviaSyndicate" => "The Cavia",
        "HexSyndicate" => "The Hex",
        _ => "",
    };
    if !known.is_empty() {
        return known.to_string();
    }
    name_from_path(tag.trim_end_matches("Syndicate"))
}

/// Friendly intrinsic name from a DE PlayerSkills key (best-effort).
fn intrinsic_label(key: &str) -> String {
    let k = key.trim_start_matches("LPP_").trim_start_matches("LPS_");
    match k {
        "SPACE" => "Railjack".to_string(),
        "DRIFTER" | "DRIFT" => "Drifter".to_string(),
        "PILOTING" => "Piloting".to_string(),
        "GUNNERY" => "Gunnery".to_string(),
        "TACTICAL" => "Tactical".to_string(),
        "ENGINEERING" => "Engineering".to_string(),
        "COMMAND" => "Command".to_string(),
        other => name_from_path(other),
    }
}

/// Store a freshly-parsed snapshot: wipe and re-insert every account_* table in one
/// transaction. nodes_total comes from the bundled star-chart node set.
pub fn store_snapshot(db: &Db, snap: &AccountSnapshot) -> AppResult<()> {
    let nodes_total = crate::worldstate::star_chart_node_count() as i64;
    let scanned_at = Utc::now().to_rfc3339();

    // Aggregate duplicates: keep the highest-rank copy of each gear item; sum stacks.
    let mut gear: HashMap<(String, String), (i64, i64)> = HashMap::new();
    for g in &snap.gear {
        let e = gear
            .entry((g.unique_name.clone(), g.category.clone()))
            .or_insert((0, 0));
        if g.rank >= e.0 {
            *e = (g.rank, g.xp);
        }
    }
    let mut resources: HashMap<String, (String, i64)> = HashMap::new();
    for r in &snap.resources {
        let e = resources
            .entry(r.unique_name.clone())
            .or_insert((r.kind.clone(), 0));
        e.1 += r.count;
    }

    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        for t in [
            "account_profile",
            "account_gear",
            "account_resources",
            "account_mastery",
            "account_lore_scans",
            "account_intrinsics",
            "account_syndicates",
        ] {
            // Table names are literals, not user input.
            tx.execute(&format!("DELETE FROM {t}"), [])?;
        }

        let p = &snap.profile;
        tx.execute(
            "INSERT INTO account_profile (id, scanned_at, mastery_rank, equipped_glyph, created,
                credits, platinum, regal_aya, endo, trades_remaining, gifts_remaining,
                nodes_completed, nodes_total, total_missions, daily_focus, focus_xp, login_streak,
                guild_id, alignment, training_date)
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                scanned_at, p.mastery_rank, p.equipped_glyph, p.created, p.credits, p.platinum,
                p.regal_aya, p.endo, p.trades_remaining, p.gifts_remaining, p.nodes_completed,
                nodes_total, p.total_missions, p.daily_focus, p.focus_xp, p.login_streak,
                p.guild_id, p.alignment, p.training_date
            ],
        )?;
        {
            let mut s = tx.prepare(
                "INSERT INTO account_gear (unique_name, category, rank, xp) VALUES (?1, ?2, ?3, ?4)",
            )?;
            for ((un, cat), (rank, xp)) in &gear {
                s.execute(params![un, cat, rank, xp])?;
            }
        }
        {
            let mut s = tx.prepare(
                "INSERT INTO account_resources (unique_name, kind, count) VALUES (?1, ?2, ?3)",
            )?;
            for (un, (kind, count)) in &resources {
                s.execute(params![un, kind, count])?;
            }
        }
        {
            let mut s = tx
                .prepare("INSERT OR REPLACE INTO account_mastery (unique_name, xp) VALUES (?1, ?2)")?;
            for m in &snap.mastery {
                s.execute(params![m.unique_name, m.xp])?;
            }
        }
        {
            let mut s = tx.prepare(
                "INSERT OR REPLACE INTO account_lore_scans (unique_name, scans) VALUES (?1, ?2)",
            )?;
            for l in &snap.lore_scans {
                s.execute(params![l.unique_name, l.scans])?;
            }
        }
        {
            let mut s = tx.prepare(
                "INSERT OR REPLACE INTO account_intrinsics (skill_key, rank) VALUES (?1, ?2)",
            )?;
            for i in &snap.intrinsics {
                s.execute(params![i.skill_key, i.rank])?;
            }
        }
        {
            let mut s = tx.prepare(
                "INSERT OR REPLACE INTO account_syndicates (tag, standing, title) VALUES (?1, ?2, ?3)",
            )?;
            for sy in &snap.syndicates {
                s.execute(params![sy.tag, sy.standing, sy.title])?;
            }
        }
        tx.commit()?;
        Ok(())
    })?;
    meta::set(db, meta::KEY_LAST_ACCOUNT_SCAN, &scanned_at)?;
    tracing::info!(
        gear = gear.len(),
        resources = resources.len(),
        "account snapshot stored"
    );
    Ok(())
}

/// True once a scan has populated the snapshot.
fn has_snapshot(c: &Connection) -> AppResult<bool> {
    let n: i64 = c.query_row("SELECT COUNT(*) FROM account_profile", [], |r| r.get(0))?;
    Ok(n > 0)
}

/// Sum of approximate mastery points across all owned gear.
fn total_mastery_points(c: &Connection) -> AppResult<i64> {
    let mut stmt = c.prepare("SELECT category, rank FROM account_gear")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    let mut total = 0i64;
    for row in rows {
        let (cat, rank) = row?;
        total += mastery::mastery_points(&cat, rank);
    }
    Ok(total)
}

/// The Profile tab payload (reads the persisted snapshot; works game-closed).
pub fn get_profile(db: &Db) -> AppResult<AccountProfile> {
    db.read(|c| {
        if !has_snapshot(c)? {
            return Ok(AccountProfile {
                has_data: false,
                scanned_at: None,
                mastery_rank: 0,
                mr_into_next: 0,
                mr_needed: 1,
                equipped_glyph: None,
                equipped_glyph_name: None,
                created: None,
                credits: 0,
                platinum: 0,
                regal_aya: 0,
                endo: 0,
                trades_remaining: 0,
                gifts_remaining: 0,
                nodes_completed: 0,
                nodes_total: 0,
                total_missions: 0,
                daily_focus: 0,
                focus_xp: 0,
                login_streak: 0,
                guild_id: None,
                alignment: None,
                training_date: None,
                total_mastery_points: 0,
                intrinsics: Vec::new(),
                syndicates: Vec::new(),
            });
        }
        let total_points = total_mastery_points(c)?;
        // Total accumulated affinity ≈ the per-item XPInfo sum; drives MR progress.
        let total_affinity: i64 = c.query_row(
            "SELECT COALESCE(SUM(xp), 0) FROM account_mastery",
            [],
            |r| r.get(0),
        )?;
        let (_, mr_into_next, mr_needed) = mastery::mr_progress(total_affinity);

        let intrinsics = c
            .prepare("SELECT skill_key, rank FROM account_intrinsics ORDER BY skill_key")?
            .query_map([], |r| {
                let skill_key: String = r.get(0)?;
                Ok(IntrinsicRow {
                    label: intrinsic_label(&skill_key),
                    skill_key,
                    rank: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let syndicates = c
            .prepare("SELECT tag, standing, title FROM account_syndicates ORDER BY standing DESC")?
            .query_map([], |r| {
                let tag: String = r.get(0)?;
                Ok(SyndicateRow {
                    label: syndicate_label(&tag),
                    tag,
                    standing: r.get(1)?,
                    title: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        c.query_row(
            "SELECT scanned_at, mastery_rank, equipped_glyph, created, credits, platinum,
                    regal_aya, endo, trades_remaining, gifts_remaining, nodes_completed,
                    nodes_total, total_missions, daily_focus, focus_xp, login_streak,
                    guild_id, alignment, training_date
             FROM account_profile WHERE id = 1",
            [],
            |r| {
                let equipped_glyph: Option<String> = r.get(2)?;
                Ok(AccountProfile {
                    has_data: true,
                    scanned_at: r.get(0)?,
                    mastery_rank: r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    mr_into_next,
                    mr_needed,
                    equipped_glyph_name: equipped_glyph.as_deref().map(name_from_path),
                    equipped_glyph,
                    created: r.get(3)?,
                    credits: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    platinum: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                    regal_aya: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
                    endo: r.get::<_, Option<i64>>(7)?.unwrap_or(0),
                    trades_remaining: r.get::<_, Option<i64>>(8)?.unwrap_or(0),
                    gifts_remaining: r.get::<_, Option<i64>>(9)?.unwrap_or(0),
                    nodes_completed: r.get::<_, Option<i64>>(10)?.unwrap_or(0),
                    nodes_total: r.get::<_, Option<i64>>(11)?.unwrap_or(0),
                    total_missions: r.get::<_, Option<i64>>(12)?.unwrap_or(0),
                    daily_focus: r.get::<_, Option<i64>>(13)?.unwrap_or(0),
                    focus_xp: r.get::<_, Option<i64>>(14)?.unwrap_or(0),
                    login_streak: r.get::<_, Option<i64>>(15)?.unwrap_or(0),
                    guild_id: r.get(16)?,
                    alignment: r.get(17)?,
                    training_date: r.get(18)?,
                    total_mastery_points: total_points,
                    intrinsics,
                    syndicates,
                })
            },
        )
        .map_err(Into::into)
    })
}

/// The Arsenal tab payload: owned gear resolved to name/icon/slug, with mastered state.
pub fn get_arsenal(db: &Db) -> AppResult<Vec<GearRow>> {
    db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT g.unique_name, g.category, g.rank,
                    m.display_name, m.icon_path, m.max_rank, m.mastery_req,
                    ci.slug, ci.display_name, ci.thumbnail_url
             FROM account_gear g
             LEFT JOIN item_manifest m ON m.unique_name = g.unique_name
             LEFT JOIN catalog_items ci ON ci.game_ref = g.unique_name",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let unique_name: String = r.get(0)?;
                let category: String = r.get(1)?;
                let rank: i64 = r.get(2)?;
                let m_name: Option<String> = r.get(3)?;
                let icon_path: Option<String> = r.get(4)?;
                let m_max: Option<i64> = r.get(5)?;
                let mastery_req: Option<i64> = r.get(6)?;
                let slug: Option<String> = r.get(7)?;
                let c_name: Option<String> = r.get(8)?;
                let thumb: Option<String> = r.get(9)?;
                let max_rank = mastery::gear_max_rank(m_max);
                let display_name = c_name
                    .or(m_name)
                    .unwrap_or_else(|| name_from_path(&unique_name));
                let icon_url = thumb.or_else(|| cdn_icon(icon_path));
                Ok(GearRow {
                    unique_name,
                    display_name,
                    category,
                    icon_url,
                    slug,
                    rank,
                    max_rank,
                    mastered: mastery::is_mastered(rank, max_rank),
                    mastery_req,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

/// The Resources tab payload: every owned stack resolved to name/icon.
pub fn get_resources(db: &Db) -> AppResult<Vec<ResourceRow>> {
    db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT r.unique_name, r.kind, r.count,
                    m.display_name, m.icon_path,
                    ci.slug, ci.display_name, ci.thumbnail_url
             FROM account_resources r
             LEFT JOIN item_manifest m ON m.unique_name = r.unique_name
             LEFT JOIN catalog_items ci ON ci.game_ref = r.unique_name",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let unique_name: String = r.get(0)?;
                let kind: String = r.get(1)?;
                let count: i64 = r.get(2)?;
                let m_name: Option<String> = r.get(3)?;
                let icon_path: Option<String> = r.get(4)?;
                let slug: Option<String> = r.get(5)?;
                let c_name: Option<String> = r.get(6)?;
                let thumb: Option<String> = r.get(7)?;
                let display_name = c_name
                    .or(m_name)
                    .unwrap_or_else(|| name_from_path(&unique_name));
                let icon_url = thumb.or_else(|| cdn_icon(icon_path));
                Ok(ResourceRow {
                    unique_name,
                    display_name,
                    kind,
                    icon_url,
                    slug,
                    count,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

/// The Codex tab payload: per-category collection % (owned-vs-missing against the
/// manifest denominator), mastered counts, total mastery points, lore scans.
pub fn get_codex(db: &Db) -> AppResult<CodexData> {
    db.read(|c| {
        if !has_snapshot(c)? {
            return Ok(CodexData {
                has_data: false,
                categories: Vec::new(),
                total_owned: 0,
                total_items: 0,
                total_mastered: 0,
                total_mastery_points: 0,
                lore_scans: Vec::new(),
            });
        }
        // Denominator: masterable manifest rows per category.
        let mut totals: HashMap<String, i64> = HashMap::new();
        {
            let mut stmt = c.prepare(
                "SELECT category, COUNT(*) FROM item_manifest WHERE max_rank IS NOT NULL GROUP BY category",
            )?;
            let rows =
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
            for row in rows {
                let (cat, n) = row?;
                totals.insert(cat, n);
            }
        }
        // Owned + mastered per category (manifest items the player actually has).
        let mut owned: HashMap<String, (i64, i64)> = HashMap::new();
        {
            let mut stmt = c.prepare(
                "SELECT m.category, COUNT(*),
                        SUM(CASE WHEN g.rank >= m.max_rank THEN 1 ELSE 0 END)
                 FROM item_manifest m
                 JOIN account_gear g ON g.unique_name = m.unique_name
                 WHERE m.max_rank IS NOT NULL
                 GROUP BY m.category",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?;
            for row in rows {
                let (cat, own, mastered) = row?;
                owned.insert(cat, (own, mastered));
            }
        }
        let mut categories: Vec<CodexCategory> = totals
            .into_iter()
            .map(|(category, total)| {
                let (own, mastered) = owned.get(&category).copied().unwrap_or((0, 0));
                CodexCategory {
                    category,
                    owned: own.min(total),
                    total,
                    mastered,
                }
            })
            .collect();
        categories.sort_by(|a, b| b.total.cmp(&a.total).then(a.category.cmp(&b.category)));

        let total_owned: i64 = categories.iter().map(|c| c.owned).sum();
        let total_items: i64 = categories.iter().map(|c| c.total).sum();
        let total_mastered: i64 = categories.iter().map(|c| c.mastered).sum();

        let lore_scans = c
            .prepare(
                "SELECT l.unique_name, l.scans, m.display_name
                 FROM account_lore_scans l
                 LEFT JOIN item_manifest m ON m.unique_name = l.unique_name
                 ORDER BY l.scans DESC",
            )?
            .query_map([], |r| {
                let un: String = r.get(0)?;
                let scans: i64 = r.get(1)?;
                let name: Option<String> = r.get(2)?;
                Ok(LoreScanRow {
                    display_name: name.unwrap_or_else(|| name_from_path(&un)),
                    scans,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(CodexData {
            has_data: true,
            categories,
            total_owned,
            total_items,
            total_mastered,
            total_mastery_points: total_mastery_points(c)?,
            lore_scans,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_manifest_parses_and_has_gear_and_resources() {
        let rows = bundled_rows();
        assert!(
            rows.len() > 1500,
            "expected the full bundle, got {}",
            rows.len()
        );
        let warframes = rows.iter().filter(|r| r.category == "warframe").count();
        assert!(warframes > 50, "expected many warframes, got {warframes}");
        // Gear rows have a max_rank; resources do not.
        let gear = rows.iter().find(|r| r.category == "warframe").unwrap();
        assert_eq!(gear.max_rank, Some(30));
        assert!(rows
            .iter()
            .any(|r| r.category == "resource" && r.max_rank.is_none()));
    }

    #[test]
    fn seed_populates_then_is_idempotent() {
        let db = crate::db::testutil::test_db("manifest-seed");
        seed_if_empty_or_stale(&db).unwrap();
        let n = manifest_count(&db).unwrap();
        assert!(n > 1500);
        // Re-seeding with the same version is a no-op (count unchanged).
        seed_if_empty_or_stale(&db).unwrap();
        assert_eq!(manifest_count(&db).unwrap(), n);
    }

    #[test]
    fn store_snapshot_round_trips_through_readers() {
        use crate::gamescan::account::{OwnedGearRaw, OwnedStackRaw, ProfileRaw, XpRow};
        let db = crate::db::testutil::test_db("acct-roundtrip");
        seed_if_empty_or_stale(&db).unwrap(); // manifest = the Codex denominator

        // Pick a real warframe uniqueName from the bundled manifest so the join resolves.
        let frame_un: String = db
            .with(|c| {
                Ok(c.query_row(
                    "SELECT unique_name FROM item_manifest WHERE category='warframe' LIMIT 1",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();

        let snap = AccountSnapshot {
            account_id: Some("acc1".into()),
            profile: ProfileRaw {
                mastery_rank: Some(22),
                platinum: Some(3387),
                endo: Some(84190),
                ..Default::default()
            },
            gear: vec![OwnedGearRaw {
                unique_name: frame_un.clone(),
                category: "warframe".into(),
                rank: 30,
                xp: 900_000,
            }],
            resources: vec![OwnedStackRaw {
                unique_name: "/Lotus/Types/Items/MiscItems/Ferrite".into(),
                kind: "resource".into(),
                count: 4210,
            }],
            mastery: vec![XpRow {
                unique_name: frame_un.clone(),
                xp: 900_000,
            }],
            ..Default::default()
        };
        store_snapshot(&db, &snap).unwrap();

        let profile = get_profile(&db).unwrap();
        assert!(profile.has_data);
        assert_eq!(profile.mastery_rank, 22);
        assert_eq!(profile.platinum, 3387);
        assert!(
            profile.nodes_total > 250,
            "star-chart denominator from sol_nodes"
        );
        assert_eq!(profile.total_mastery_points, 30 * 200);

        let arsenal = get_arsenal(&db).unwrap();
        assert_eq!(arsenal.len(), 1);
        assert!(arsenal[0].mastered, "rank 30 of 30 → mastered");
        assert!(arsenal[0].icon_url.is_some(), "resolved icon from manifest");

        let resources = get_resources(&db).unwrap();
        assert!(resources.iter().any(|r| r.count == 4210));

        let codex = get_codex(&db).unwrap();
        assert!(codex.has_data);
        let wf = codex
            .categories
            .iter()
            .find(|c| c.category == "warframe")
            .unwrap();
        assert_eq!(wf.owned, 1);
        assert_eq!(wf.mastered, 1);
        assert!(wf.total > 50, "manifest denominator for warframes");
    }
}
