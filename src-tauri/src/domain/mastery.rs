//! Pure mastery math: cumulative-affinity → Mastery Rank, per-item max rank / mastered
//! state, and (approximate) mastery-point contributions. No I/O. Fed by the scanned
//! `XPInfo` + `item_manifest.max_rank`.
//!
//! DE's thresholds: ranks 1..=30 need `2500 * rank^2` cumulative affinity; Legendary
//! ranks (31+) add `147_500` each on top of MR30's `2_250_000`. Mastery points per
//! item rank: 200 for frames/companions/archwing/necramech, 100 for weapons — this is
//! the standard approximation (archwing lumps frames+weapons, so the total is best-effort).

/// Cumulative affinity required to REACH `rank`.
pub fn xp_threshold(rank: i64) -> i64 {
    if rank <= 0 {
        0
    } else if rank <= 30 {
        2_500 * rank * rank
    } else {
        2_250_000 + 147_500 * (rank - 30)
    }
}

/// Mastery Rank from total accumulated affinity: the highest rank whose threshold is met.
pub fn mr_from_total_xp(total: i64) -> i64 {
    if total < xp_threshold(1) {
        return 0;
    }
    // Walk up while the next threshold is still covered. Bounded (MR is small).
    let mut rank = 0;
    while xp_threshold(rank + 1) <= total {
        rank += 1;
        if rank > 5000 {
            break; // defensive: never loop unbounded on absurd input
        }
    }
    rank
}

/// MR progress as `(current_rank, affinity_into_current, affinity_needed_for_next)`.
pub fn mr_progress(total: i64) -> (i64, i64, i64) {
    let current = mr_from_total_xp(total);
    let base = xp_threshold(current);
    let next = xp_threshold(current + 1);
    (current, (total - base).max(0), (next - base).max(1))
}

/// A gear item's max rank: the manifest value when known, else 30 (the common cap).
pub fn gear_max_rank(manifest_max: Option<i64>) -> i64 {
    manifest_max.unwrap_or(30)
}

/// Whether an owned instance is fully ranked ("mastered" for the Codex).
pub fn is_mastered(rank: i64, max_rank: i64) -> bool {
    max_rank > 0 && rank >= max_rank
}

/// Mastery points per rank for a category (200 for frame-likes, 100 for weapons).
pub fn points_per_rank(category: &str) -> i64 {
    match category {
        "warframe" | "companion" | "necramech" | "archwing" => 200,
        _ => 100, // primary/secondary/melee/amp/special/railjack
    }
}

/// Approximate mastery points a single owned item contributes at its current rank.
pub fn mastery_points(category: &str, rank: i64) -> i64 {
    points_per_rank(category) * rank.max(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mr_thresholds_at_boundaries() {
        assert_eq!(mr_from_total_xp(0), 0);
        assert_eq!(mr_from_total_xp(2_499), 0);
        assert_eq!(mr_from_total_xp(2_500), 1); // 2500 * 1^2
        assert_eq!(mr_from_total_xp(9_999), 1);
        assert_eq!(mr_from_total_xp(10_000), 2); // 2500 * 2^2
        assert_eq!(mr_from_total_xp(2_250_000), 30); // 2500 * 30^2
        assert_eq!(mr_from_total_xp(2_250_000 - 1), 29);
        assert_eq!(mr_from_total_xp(2_250_000 + 147_500), 31); // first Legendary
    }

    #[test]
    fn progress_splits_into_next() {
        // Exactly at MR2: 0 into current, full bar to MR3.
        let (cur, into, needed) = mr_progress(10_000);
        assert_eq!(cur, 2);
        assert_eq!(into, 0);
        assert_eq!(needed, xp_threshold(3) - xp_threshold(2));
    }

    #[test]
    fn mastered_and_points() {
        assert!(is_mastered(30, 30));
        assert!(is_mastered(40, 40));
        assert!(!is_mastered(29, 30));
        assert!(!is_mastered(5, 0)); // unknown max never counts as mastered
        assert_eq!(mastery_points("warframe", 30), 6_000);
        assert_eq!(mastery_points("primary", 30), 3_000);
        assert_eq!(gear_max_rank(None), 30);
        assert_eq!(gear_max_rank(Some(40)), 40);
    }
}
