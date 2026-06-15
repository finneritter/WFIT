//! Match free-text worldstate reward strings (invasion rewards like "2 Fieldron",
//! Steel Path rotation reward names) to catalog item names. Pure token-containment —
//! deliberately lower-fidelity (reward strings are free text), kept safe by only ever
//! being run against the user's small "wanted" set (see `db::wanted`), so a loose
//! match can at worst surface an item the user already cares about.

use std::collections::HashSet;

/// True when `reward_norm` refers to the catalog item `name_norm` (both already
/// normalized via `catalog::normalize_name`): every word of the item name must appear
/// in the reward, and the name must be ≥2 words so single-word noise ("blueprint",
/// "forma", "kuva") can't match half the catalog.
pub fn reward_matches(reward_norm: &str, name_norm: &str) -> bool {
    let name_tokens: Vec<&str> = name_norm.split(' ').filter(|t| !t.is_empty()).collect();
    if name_tokens.len() < 2 {
        return false;
    }
    let reward_tokens: HashSet<&str> = reward_norm.split(' ').filter(|t| !t.is_empty()).collect();
    name_tokens.iter().all(|t| reward_tokens.contains(t))
}

#[cfg(test)]
mod tests {
    use super::reward_matches;

    #[test]
    fn matches_when_all_name_words_present() {
        // invasion-style reward carrying a count prefix + extra "blueprint" word.
        assert!(reward_matches(
            "2 wraith twin vipers blueprint",
            "wraith twin vipers"
        ));
        assert!(reward_matches("ash prime systems", "ash prime systems"));
    }

    #[test]
    fn rejects_single_word_names() {
        // "forma" must not match every reward that happens to contain it.
        assert!(!reward_matches("umbra forma blueprint", "forma"));
    }

    #[test]
    fn rejects_partial_name() {
        // missing "systems" → not this part.
        assert!(!reward_matches("ash prime blueprint", "ash prime systems"));
    }
}
