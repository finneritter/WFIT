//! OCR line → relic reward name resolution.
//!
//! The reward-screen OCR output is noisy ("ASH PRLME SYSTEMIS BLUEPRINT"), but the
//! universe of strings it can legitimately be is tiny: the ~600 distinct reward
//! names in the relic drop tables (incl. Forma/Kuva). So matching is a nearest-
//! neighbour search over that closed vocabulary with normalized-Levenshtein
//! similarity, not a parse. Anything below [`MIN_CONFIDENCE`] is treated as a
//! non-reward line (mission stats, player names, buttons) and dropped.

use crate::db::catalog::normalize_name;
use crate::domain::relic;

/// Similarity floor for accepting a vocabulary entry as the meaning of an OCR
/// line. 0.7 tolerates several character-level OCR errors on typical name lengths
/// while keeping unrelated UI strings (which score ~0.2–0.5) out.
pub const MIN_CONFIDENCE: f64 = 0.7;

/// Lines shorter than this after normalization can't clear MIN_CONFIDENCE against
/// any real reward name; skip them before scoring.
const MIN_LINE_LEN: usize = 6;

/// One vocabulary entry: a reward display name and its normalized matching key.
struct VocabEntry {
    normalized: String,
    display: String,
}

/// The closed matching vocabulary, built from the live relic snapshot (which is
/// runtime-swappable after a game-data refresh — so build per capture, it's cheap).
pub struct RewardVocab {
    entries: Vec<VocabEntry>,
}

/// A resolved OCR line.
#[derive(Debug, Clone, PartialEq)]
pub struct LineMatch {
    /// Canonical reward display name (resolves to a catalog slug downstream).
    pub display_name: String,
    /// Normalized-Levenshtein similarity in [MIN_CONFIDENCE, 1.0].
    pub confidence: f64,
}

/// Collect every distinct reward name across all relics (Intact suffices — all
/// refinements of a relic share the same six reward names, only chances differ).
pub fn build_vocab() -> RewardVocab {
    let mut seen = std::collections::HashSet::new();
    let mut entries = Vec::new();
    for (tier, name) in relic::all_relics() {
        if let Some(drops) = relic::drops_for(&tier, &name, "Intact") {
            for d in drops {
                let normalized = normalize_name(&d.reward_name);
                if !normalized.is_empty() && seen.insert(normalized.clone()) {
                    entries.push(VocabEntry {
                        normalized,
                        display: d.reward_name,
                    });
                }
            }
        }
    }
    RewardVocab { entries }
}

/// Resolve one OCR line to the best-scoring reward name, or None if nothing in
/// the vocabulary is close enough. Ties go to the longer name so "2X Forma
/// Blueprint" isn't swallowed by "Forma Blueprint".
pub fn match_line(vocab: &RewardVocab, raw: &str) -> Option<LineMatch> {
    let line = normalize_name(raw);
    if line.len() < MIN_LINE_LEN {
        return None;
    }
    let mut best: Option<(&VocabEntry, f64)> = None;
    for entry in &vocab.entries {
        let sim = strsim::normalized_levenshtein(&line, &entry.normalized);
        if sim < MIN_CONFIDENCE {
            continue;
        }
        let better = match best {
            None => true,
            Some((b, bs)) => sim > bs || (sim == bs && entry.normalized.len() > b.normalized.len()),
        };
        if better {
            best = Some((entry, sim));
        }
    }
    best.map(|(entry, confidence)| LineMatch {
        display_name: entry.display.clone(),
        confidence,
    })
}

/// Resolve a batch of OCR lines (in on-screen order), dropping non-reward lines,
/// deduping repeated hits on the same reward (keep the highest-confidence one, at
/// its first position), and capping at `cap` (a squad shows at most 4 cards).
pub fn match_lines(vocab: &RewardVocab, lines: &[String], cap: usize) -> Vec<LineMatch> {
    let mut out: Vec<LineMatch> = Vec::new();
    for raw in lines {
        let Some(m) = match_line(vocab, raw) else {
            continue;
        };
        match out.iter_mut().find(|e| e.display_name == m.display_name) {
            Some(existing) => {
                if m.confidence > existing.confidence {
                    existing.confidence = m.confidence;
                }
            }
            None => out.push(m),
        }
    }
    out.truncate(cap);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vocab() -> RewardVocab {
        let v = build_vocab();
        assert!(
            v.entries.len() > 400,
            "bundled relic tables should yield hundreds of reward names, got {}",
            v.entries.len()
        );
        v
    }

    #[test]
    fn exact_name_is_full_confidence() {
        let v = vocab();
        let m = match_line(&v, "Akstiletto Prime Barrel").unwrap();
        assert_eq!(m.display_name, "Akstiletto Prime Barrel");
        assert!((m.confidence - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn ocr_noise_resolves() {
        let v = vocab();
        // Case + a few character-level OCR errors.
        let m = match_line(&v, "BRATON PRLME ST0CK").unwrap();
        assert_eq!(m.display_name, "Braton Prime Stock");
        assert!(m.confidence >= MIN_CONFIDENCE);
    }

    #[test]
    fn forma_variants_stay_distinct() {
        let v = vocab();
        assert_eq!(
            match_line(&v, "FORMA BLUEPRINT").unwrap().display_name,
            "Forma Blueprint"
        );
        assert_eq!(
            match_line(&v, "2X FORMA BLUEPRINT").unwrap().display_name,
            "2X Forma Blueprint"
        );
    }

    #[test]
    fn garbage_is_rejected() {
        let v = vocab();
        for junk in [
            "MISSION COMPLETE",
            "SELECT A REWARD",
            "VOID TRACES 87",
            "xX_TennoSlayer_Xx",
            "",
            "ab",
        ] {
            assert!(match_line(&v, junk).is_none(), "matched junk: {junk}");
        }
    }

    #[test]
    fn batch_dedupes_keeps_order_and_caps() {
        let v = vocab();
        let lines = vec![
            "Braton Prime Stock".to_string(),
            "SELECT A REWARD".to_string(),
            "Akstiletto Prime Barrel".to_string(),
            "BRATON PRIME STOCK".to_string(), // dupe, noisier
            "Forma Blueprint".to_string(),
            "2X Forma Blueprint".to_string(),
            "Akbolto Prime Barrel".to_string(), // 5th distinct — beyond cap
        ];
        let got = match_lines(&v, &lines, 4);
        let names: Vec<&str> = got.iter().map(|m| m.display_name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Braton Prime Stock",
                "Akstiletto Prime Barrel",
                "Forma Blueprint",
                "2X Forma Blueprint"
            ]
        );
    }
}
