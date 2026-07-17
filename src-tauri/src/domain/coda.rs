//! Coda-weapon domain facts — the closed vocabulary and bonus formatting for
//! Eleanor's shop rotation. Pure (no DB, no network). The OCR capture path
//! (`relic_ocr`/`coda_ocr`) matches recognized text against these; the Vendors
//! screen renders `format_bonus`.
//!
//! There is NO API source for Eleanor's current rotation (verified 2026-07-17:
//! neither DE `worldState.php` nor warframestat expose it), so the four weapons
//! and their progenitor bonus are read off her shop screen by OCR — these lists
//! are the recognizer's target vocabulary.

/// Every Coda weapon Eleanor can offer (source: wiki.warframe.com/w/Coda_Weapons,
/// verified 2026-07-17). Re-check when DE adds Coda variants.
pub const CODA_WEAPONS: [&str; 14] = [
    "Coda Bassocyst",
    "Coda Bubonico",
    "Coda Catabolyst",
    "Coda Caustacyst",
    "Coda Hema",
    "Coda Hirudo",
    "Coda Mire",
    "Coda Motovore",
    "Coda Pathocyst",
    "Coda Pox",
    "Coda Sporothrix",
    "Coda Synapse",
    "Coda Tysis",
    "Dual Coda Torxica",
];

/// The seven progenitor bonus elements a Coda weapon can roll.
pub const BONUS_ELEMENTS: [&str; 7] = [
    "Impact",
    "Heat",
    "Cold",
    "Electricity",
    "Toxin",
    "Magnetic",
    "Radiation",
];

/// Bonus % is a random integer in this inclusive range (lower more common).
pub const PCT_MIN: u8 = 25;
pub const PCT_MAX: u8 = 60;

/// The vendor row label for a progenitor bonus, e.g. `"+45% Heat"`. Rust owns
/// the formatting so the frontend renders a finished string.
pub fn format_bonus(element: &str, pct: u8) -> String {
    format!("+{pct}% {element}")
}

/// Whether a recognized (weapon, element, pct) triple is a plausible Coda offer —
/// used by the OCR capture path to reject misreads before storing.
pub fn is_valid_offer(weapon: &str, element: &str, pct: u8) -> bool {
    CODA_WEAPONS.contains(&weapon)
        && BONUS_ELEMENTS.contains(&element)
        && (PCT_MIN..=PCT_MAX).contains(&pct)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocab_sizes() {
        assert_eq!(CODA_WEAPONS.len(), 14);
        assert_eq!(BONUS_ELEMENTS.len(), 7);
        // No dupes crept in.
        let mut w = CODA_WEAPONS.to_vec();
        w.sort_unstable();
        w.dedup();
        assert_eq!(w.len(), 14);
    }

    #[test]
    fn bonus_formats() {
        assert_eq!(format_bonus("Heat", 45), "+45% Heat");
        assert_eq!(format_bonus("Radiation", 60), "+60% Radiation");
    }

    #[test]
    fn offer_validation() {
        assert!(is_valid_offer("Coda Motovore", "Cold", 32));
        assert!(is_valid_offer("Dual Coda Torxica", "Impact", 25));
        assert!(!is_valid_offer("Kuva Bramma", "Heat", 40)); // wrong weapon family
        assert!(!is_valid_offer("Coda Hema", "Blast", 40)); // Blast isn't a progenitor element
        assert!(!is_valid_offer("Coda Hema", "Heat", 61)); // out of range
        assert!(!is_valid_offer("Coda Hema", "Heat", 24)); // out of range
    }
}
