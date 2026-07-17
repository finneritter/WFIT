//! Eleanor's Coda-weapon rotation: the store the OCR capture writes, and the
//! Vendors-board column built from it. There is no API for the current rotation
//! (verified 2026-07-17), so it's OCR'd off her shop and persisted here; the
//! Höllvania tab reads `eleanor_panel`.

use crate::db::{vendor_checkoff, Db};
use crate::domain::coda;
use crate::error::AppResult;
use crate::types::{VendorIntelRow, VendorPanel};
use rusqlite::params;

/// Every Coda weapon costs 10 Live Heartcells from Eleanor.
const HEARTCELL_COST: i64 = 10;

/// One captured shop slot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodaOffer {
    pub slot: u8,
    pub weapon: String,
    pub element: String,
    pub pct: u8,
    pub captured_at: String,
}

/// The stored rotation, ascending slot. Empty until the first OCR capture.
pub fn get_rotation(db: &Db) -> AppResult<Vec<CodaOffer>> {
    db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT slot, weapon, element, pct, captured_at FROM coda_rotation ORDER BY slot",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(CodaOffer {
                    slot: r.get::<_, i64>(0)? as u8,
                    weapon: r.get(1)?,
                    element: r.get(2)?,
                    pct: r.get::<_, i64>(3)? as u8,
                    captured_at: r.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
}

/// Replace the whole rotation with a fresh capture. Transactional so a stale
/// slot never lingers next to a new one.
// Written by the OCR capture path (Half 2); unused until that lands.
#[allow(dead_code)]
pub fn store_rotation(db: &Db, offers: &[CodaOffer]) -> AppResult<()> {
    db.with_mut(|c| {
        let tx = c.transaction()?;
        tx.execute("DELETE FROM coda_rotation", [])?;
        for o in offers {
            tx.execute(
                "INSERT INTO coda_rotation (slot, weapon, element, pct, captured_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    o.slot as i64,
                    o.weapon,
                    o.element,
                    o.pct as i64,
                    o.captured_at
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

/// Eleanor's Vendors-board column, built from the stored rotation. Coda weapons
/// aren't in warframe.market's catalog, so rows are priceless and manual-check
/// only; each carries its progenitor bonus badge and the flat 10-Heartcell cost.
/// Rows are empty until the shop is first OCR'd.
pub fn eleanor_panel(db: &Db) -> AppResult<VendorPanel> {
    let rotation = get_rotation(db)?;
    let manual = vendor_checkoff::set_for(db, "eleanor")?;
    let rows = rotation
        .into_iter()
        // Defensive: never render a row a corrupt/stale capture shouldn't have
        // produced (Half 2 also validates before storing).
        .filter(|o| coda::is_valid_offer(&o.weapon, &o.element, o.pct))
        .map(|o| {
            let item_ref = o.weapon.clone();
            let checked = manual.contains(&item_ref);
            VendorIntelRow {
                item: o.weapon,
                slug: None,
                thumbnail_url: None,
                median_plat: None,
                owned_qty: 0,
                cost: Some(HEARTCELL_COST),
                currency: "live_heartcell".to_string(),
                credits: None,
                cost_per_plat: None,
                good_deal: false,
                item_ref,
                tradeable: false,
                checked,
                check_source: checked.then(|| "manual".to_string()),
                rank: None,
                bonus: Some(coda::format_bonus(&o.element, o.pct)),
            }
        })
        .collect();
    Ok(VendorPanel {
        key: "eleanor".to_string(),
        name: "Eleanor".to_string(),
        character: Some("The Hex".to_string()),
        location: Some("Höllvania".to_string()),
        currency: "live_heartcell".to_string(),
        active: true,
        activation: None,
        expiry: None,
        rows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testutil::test_db;

    fn offer(slot: u8, weapon: &str, element: &str, pct: u8) -> CodaOffer {
        CodaOffer {
            slot,
            weapon: weapon.to_string(),
            element: element.to_string(),
            pct,
            captured_at: "2026-07-17T22:00:00Z".to_string(),
        }
    }

    #[test]
    fn rotation_roundtrip_and_replace() {
        let db = test_db("coda-rotation");
        assert!(get_rotation(&db).unwrap().is_empty());

        store_rotation(
            &db,
            &[
                offer(0, "Coda Bassocyst", "Heat", 45),
                offer(1, "Coda Motovore", "Cold", 32),
            ],
        )
        .unwrap();
        let got = get_rotation(&db).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], offer(0, "Coda Bassocyst", "Heat", 45));

        // A fresh capture fully replaces the previous rotation (no stale slots).
        store_rotation(&db, &[offer(0, "Coda Tysis", "Toxin", 50)]).unwrap();
        let got = get_rotation(&db).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].weapon, "Coda Tysis");
    }

    #[test]
    fn panel_reflects_rotation_and_bonus() {
        let db = test_db("coda-panel");
        // Empty until captured.
        let empty = eleanor_panel(&db).unwrap();
        assert_eq!(empty.key, "eleanor");
        assert!(empty.rows.is_empty());

        store_rotation(&db, &[offer(0, "Coda Bassocyst", "Heat", 45)]).unwrap();
        let panel = eleanor_panel(&db).unwrap();
        assert_eq!(panel.rows.len(), 1);
        let row = &panel.rows[0];
        assert_eq!(row.item, "Coda Bassocyst");
        assert_eq!(row.bonus.as_deref(), Some("+45% Heat"));
        assert_eq!(row.cost, Some(10));
        assert_eq!(row.currency, "live_heartcell");
        assert!(!row.tradeable);
        assert!(!row.checked);

        // Manual check-off flows through the shared vendor_checkoff table.
        vendor_checkoff::set(&db, "eleanor", "Coda Bassocyst").unwrap();
        let panel = eleanor_panel(&db).unwrap();
        assert!(panel.rows[0].checked);
        assert_eq!(panel.rows[0].check_source.as_deref(), Some("manual"));
    }
}
