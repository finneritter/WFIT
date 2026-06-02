//! Mod rarity lookup. warframe.market exposes no rarity, so we bundle a static
//! map from the WFCD `warframe-items` dataset keyed by the game `uniqueName`
//! (which equals warframe.market's `gameRef` / our `catalog_items.game_ref`).
//! Pure data — no I/O. Used to populate `catalog_items.mod_rarity`.
use once_cell::sync::Lazy;
use std::collections::HashMap;

/// `uniqueName \t rarity` (rarity lowercased: common|uncommon|rare|legendary).
const DATA: &str = include_str!("data/mod_rarity.tsv");

static MAP: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    DATA.lines()
        .filter_map(|line| line.split_once('\t'))
        .collect()
});

/// The 4 game rarities, in canonical (common→legendary) order. The single source
/// of truth for the settings toggles and validation.
pub const RARITIES: [&str; 4] = ["common", "uncommon", "rare", "legendary"];

/// Rarity for a mod's `game_ref` (uniqueName), or None if unmapped (~0.15% of mods).
pub fn rarity_for(game_ref: &str) -> Option<&'static str> {
    MAP.get(game_ref).copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_mods_resolve() {
        // Vitality (Common), Serration (Uncommon) — stable, well-known mods.
        assert_eq!(
            rarity_for("/Lotus/Upgrades/Mods/Warframe/AvatarHealthMaxMod"),
            Some("common")
        );
        assert_eq!(
            rarity_for("/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod"),
            Some("uncommon")
        );
        assert_eq!(rarity_for("/nonexistent/ref"), None);
    }

    #[test]
    fn all_values_are_canonical() {
        for (_k, v) in MAP.iter() {
            assert!(RARITIES.contains(v), "non-canonical rarity: {v}");
        }
    }
}
