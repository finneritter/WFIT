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
        // Length prefilter: sim ≤ 1 − |len diff|/max len, so entries that
        // can't clear the floor on length alone skip the Levenshtein run
        // (window matching scores many junk-padded strings).
        let (a, b) = (line.len(), entry.normalized.len());
        let max = a.max(b) as f64;
        if 1.0 - (a.abs_diff(b) as f64 / max) < MIN_CONFIDENCE {
            continue;
        }
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

/// Resolve cards given as their text SEGMENTS (top-to-bottom, from
/// `layout::group_into_card_segments`), in on-screen order, dropping
/// non-reward text, deduping repeated hits on the same reward (keep the
/// highest-confidence one, at its first position), and capping at `cap` (a
/// squad shows at most 4 cards).
///
/// Matching runs over contiguous segment runs instead of the whole joined
/// string: the game injects non-title text into a card's column — the hover
/// tooltip panel opens directly below the hovered card's title, and squadmate
/// name rows sit close under wrapped titles — and requiring the junk to match
/// too sank real titles below the floor (live 2026-07-15: a wrapped, hovered
/// title read perfectly but drowned in tooltip text).
pub fn match_cards(vocab: &RewardVocab, cards: &[Vec<String>], cap: usize) -> Vec<LineMatch> {
    let mut out: Vec<LineMatch> = Vec::new();
    for segments in cards {
        for m in match_card(vocab, segments) {
            match out.iter_mut().find(|e| e.display_name == m.display_name) {
                Some(existing) => {
                    if m.confidence > existing.confidence {
                        existing.confidence = m.confidence;
                    }
                }
                None => out.push(m),
            }
        }
    }
    out.truncate(cap);
    out
}

/// Best non-overlapping vocabulary matches within one card's segments: score
/// every contiguous run, then greedily keep winners (highest confidence, ties
/// to the longer name) whose segments aren't already claimed, in top-to-bottom
/// order. A clean card yields exactly its title; a column polluted by tooltip
/// or player-name rows still yields the title run.
fn match_card(vocab: &RewardVocab, segments: &[String]) -> Vec<LineMatch> {
    let mut candidates: Vec<(usize, usize, LineMatch)> = Vec::new();
    for start in 0..segments.len() {
        let mut text = String::new();
        for (end, seg) in segments.iter().enumerate().skip(start) {
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(seg);
            if let Some(m) = match_line(vocab, &text) {
                candidates.push((start, end, m));
            }
        }
    }
    candidates.sort_by(|a, b| {
        b.2.confidence
            .total_cmp(&a.2.confidence)
            .then(b.2.display_name.len().cmp(&a.2.display_name.len()))
    });
    let mut claimed: Vec<(usize, usize)> = Vec::new();
    let mut picked: Vec<(usize, LineMatch)> = Vec::new();
    for (start, end, m) in candidates {
        if claimed.iter().any(|&(s, e)| start <= e && end >= s) {
            continue;
        }
        claimed.push((start, end));
        picked.push((start, m));
    }
    picked.sort_by_key(|&(start, _)| start);
    picked.into_iter().map(|(_, m)| m).collect()
}

/// Resolve each card column to its single best match, or None. Position is
/// preserved (same length/order as the input): the strip overlay renders one
/// panel per column, and duplicates ACROSS columns are legitimate (radshare
/// squads crack the same relic). The hover-tooltip's repeated title lives
/// within its card's own column, so best-of-column absorbs it.
pub fn resolve_columns(vocab: &RewardVocab, cards: &[Vec<String>]) -> Vec<Option<LineMatch>> {
    cards
        .iter()
        .map(|segments| {
            match_card(vocab, segments).into_iter().max_by(|a, b| {
                a.confidence
                    .total_cmp(&b.confidence)
                    .then(a.display_name.len().cmp(&b.display_name.len()))
            })
        })
        .collect()
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
    fn hover_tooltip_and_player_name_do_not_hide_a_wrapped_title() {
        // Live 1440p failure (2026-07-15): hovering a card opens a tooltip
        // panel right below its wrapped title, and the layout column merge
        // chains the tooltip header + a squadmate's name into the card text.
        // Whole-string matching failed the floor; the title is still in there
        // as a contiguous segment run and must be found.
        let v = vocab();
        let card: Vec<String> = [
            "Voruna Prime Neurobtics", // OCR error: p → b
            "Blueprint",
            "VORUNA PRIME NEUROPTICS", // hover tooltip header, line 1
            "Pakman_56",               // squadmate name row
            "BLUEPRINT",               // hover tooltip header, line 2
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let got = match_cards(&v, &[card], 4);
        let names: Vec<&str> = got.iter().map(|m| m.display_name.as_str()).collect();
        assert_eq!(names, ["Voruna Prime Neuroptics Blueprint"]);
    }

    #[test]
    fn junk_only_cards_match_nothing_via_windows() {
        let v = vocab();
        let cards: Vec<Vec<String>> = vec![
            vec![
                "Neuroptics component of the".into(),
                "Voruna Prime Warframe.".into(),
            ],
            vec!["Pakman_56".into()],
            vec!["SELECT A".into(), "REWARD".into()],
        ];
        assert!(match_cards(&v, &cards, 4).is_empty());
    }

    #[test]
    fn batch_dedupes_keeps_order_and_caps() {
        let v = vocab();
        let cards: Vec<Vec<String>> = [
            "Braton Prime Stock",
            "SELECT A REWARD",
            "Akstiletto Prime Barrel",
            "BRATON PRIME STOCK", // dupe, noisier
            "Forma Blueprint",
            "2X Forma Blueprint",
            "Akbolto Prime Barrel", // 5th distinct — beyond cap
        ]
        .iter()
        .map(|s| vec![s.to_string()])
        .collect();
        let got = match_cards(&v, &cards, 4);
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

    #[test]
    fn duplicate_rewards_across_columns_are_preserved() {
        // Radshare: two cards legitimately show the same reward. The old
        // cross-card dedupe collapsed them — per-column resolution must not.
        let v = vocab();
        let cards: Vec<Vec<String>> = vec![
            vec!["Braton Prime Stock".into()],
            vec!["Akstiletto Prime Barrel".into()],
            vec!["BRATON PRIME STOCK".into()],
        ];
        let got = resolve_columns(&v, &cards);
        let names: Vec<Option<&str>> = got
            .iter()
            .map(|m| m.as_ref().map(|m| m.display_name.as_str()))
            .collect();
        assert_eq!(
            names,
            [
                Some("Braton Prime Stock"),
                Some("Akstiletto Prime Barrel"),
                Some("Braton Prime Stock"),
            ]
        );
    }

    #[test]
    fn tooltip_duplicate_within_a_column_yields_one_match() {
        // The hover tooltip repeats the card's own title inside the SAME
        // column; per-column best-pick must yield exactly one match.
        let v = vocab();
        let card: Vec<String> = [
            "Voruna Prime Neurobtics", // OCR error: p → b
            "Blueprint",
            "VORUNA PRIME NEUROPTICS",
            "Pakman_56",
            "BLUEPRINT",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let got = resolve_columns(&v, &[card]);
        assert_eq!(got.len(), 1);
        assert_eq!(
            got[0].as_ref().unwrap().display_name,
            "Voruna Prime Neuroptics Blueprint"
        );
    }

    #[test]
    fn junk_columns_resolve_to_none_in_place() {
        let v = vocab();
        let cards: Vec<Vec<String>> = vec![
            vec!["SELECT A".into(), "REWARD".into()],
            vec!["Forma Blueprint".into()],
            vec!["xX_TennoSlayer_Xx".into()],
        ];
        let got = resolve_columns(&v, &cards);
        assert!(got[0].is_none());
        assert_eq!(got[1].as_ref().unwrap().display_name, "Forma Blueprint");
        assert!(got[2].is_none());
    }
}
