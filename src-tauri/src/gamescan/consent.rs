//! Consent gate. The first scan is blocked behind an exact typed acknowledgment
//! (not a checkbox), reusing `warframe-helper`'s wording for familiarity. The
//! acceptance is persisted in `game_scan_state.consent_at`; revoking restores the
//! prompt. The scan codepath must refuse when not consented.

/// The exact phrase the user must type to accept the ban risk.
pub const EXPECTED_PHRASE: &str =
    "I understand and accept the risk involved in using this functionality.";

/// True only on an exact (trimmed) match of the required phrase.
pub fn validate(phrase: &str) -> bool {
    phrase.trim() == EXPECTED_PHRASE
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_phrase_passes_with_surrounding_whitespace() {
        assert!(validate(EXPECTED_PHRASE));
        assert!(validate("  I understand and accept the risk involved in using this functionality.  "));
    }

    #[test]
    fn wrong_phrase_fails() {
        assert!(!validate(""));
        assert!(!validate("i understand and accept the risk involved in using this functionality."));
        assert!(!validate("I understand and accept the risk involved in using this functionality"));
        assert!(!validate("yes"));
    }
}
