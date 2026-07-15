//! Group recognized words into reward "cards".
//!
//! The OCR engine's own line grouping happily jumps the gap between two cards
//! whose titles share a baseline (observed: all four titles came back as ONE
//! line), so card segmentation happens here at word granularity instead:
//!
//! 1. cluster words into text rows by vertical proximity,
//! 2. split each row into segments wherever the horizontal gap is far wider
//!    than a word space (card gaps are several glyph-heights wide),
//! 3. merge segments across rows by x-overlap (wrapped titles stack), and
//! 4. read each card's segments top-to-bottom, cards left-to-right.
//!
//! Titles wrap ("Akstiletto Prime" / "Barrel"), and a fragment alone often
//! can't clear the matcher's confidence floor — the joining here is what makes
//! wrapped names matchable. Pure geometry, compiled regardless of the
//! `relic-ocr` feature so its tests always run.

/// One recognized word with its bounding box in band pixels.
#[derive(Debug, Clone)]
pub struct OcrWord {
    pub text: String,
    pub left: i32,
    pub right: i32,
    pub top: i32,
    pub bottom: i32,
}

impl OcrWord {
    fn height(&self) -> i32 {
        (self.bottom - self.top).max(1)
    }
}

/// Same text row when vertical centers differ by less than this × glyph height.
const ROW_TOLERANCE: f32 = 0.6;

/// New card segment when the gap to the previous word exceeds this × glyph
/// height. Word spaces run ~0.3×; the inter-card gutter runs several ×.
const SEGMENT_GAP: f32 = 1.2;

/// Minimum fraction of the narrower segment's width that must overlap for two
/// row-segments to belong to the same card column.
const MIN_OVERLAP: f32 = 0.5;

/// Segments only stack into one card when the vertical gap between them is
/// less than this × glyph height. Wrapped title lines sit ~0.7× apart; the
/// "SELECT A REWARD" header floats several × above the cards and must NOT be
/// merged into whichever card it happens to x-overlap.
const MAX_STACK_GAP: f32 = 1.5;

struct Segment {
    text: String,
    left: i32,
    right: i32,
    top: i32,
    bottom: i32,
}

fn overlaps(a: (i32, i32), b: (i32, i32)) -> bool {
    let overlap = (a.1.min(b.1) - a.0.max(b.0)).max(0) as f32;
    let narrower = ((a.1 - a.0).min(b.1 - b.0)).max(1) as f32;
    overlap / narrower >= MIN_OVERLAP
}

/// Cluster words into rows of matching vertical center, ordered top-to-bottom,
/// each row ordered left-to-right.
fn rows(words: &[OcrWord]) -> Vec<Vec<&OcrWord>> {
    let mut sorted: Vec<&OcrWord> = words.iter().collect();
    sorted.sort_by_key(|w| w.top + w.bottom); // by vertical center ×2
    let mut rows: Vec<Vec<&OcrWord>> = Vec::new();
    for word in sorted {
        let center = (word.top + word.bottom) as f32 / 2.0;
        match rows.last_mut() {
            Some(row)
                if {
                    let last = row.last().expect("rows are never empty");
                    let last_center = (last.top + last.bottom) as f32 / 2.0;
                    (center - last_center).abs()
                        < ROW_TOLERANCE * last.height().max(word.height()) as f32
                } =>
            {
                row.push(word)
            }
            _ => rows.push(vec![word]),
        }
    }
    for row in &mut rows {
        row.sort_by_key(|w| w.left);
    }
    rows
}

/// Split one row into segments at card-sized horizontal gaps.
fn row_segments(row: &[&OcrWord]) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::new();
    for word in row {
        let gap_limit = (SEGMENT_GAP * word.height() as f32) as i32;
        match out.last_mut() {
            Some(seg) if word.left - seg.right <= gap_limit => {
                seg.text.push(' ');
                seg.text.push_str(word.text.trim());
                seg.right = seg.right.max(word.right);
                seg.top = seg.top.min(word.top);
                seg.bottom = seg.bottom.max(word.bottom);
            }
            _ => out.push(Segment {
                text: word.text.trim().to_string(),
                left: word.left,
                right: word.right,
                top: word.top,
                bottom: word.bottom,
            }),
        }
    }
    out
}

/// Each card's joined text, left→right — test-facing sugar over
/// [`group_into_card_segments`] (production joins inline for the sidecar).
#[cfg(test)]
pub fn group_into_cards(words: &[OcrWord]) -> Vec<String> {
    group_into_card_segments(words)
        .into_iter()
        .map(|segments| segments.join(" "))
        .collect()
}

/// Like [`group_into_cards`] but keeps each card's segment texts separate
/// (top-to-bottom) — the matcher scans contiguous runs so injected non-title
/// rows (hover tooltip, squadmate names) can't sink the title.
pub fn group_into_card_segments(words: &[OcrWord]) -> Vec<Vec<String>> {
    let segments: Vec<Segment> = rows(words).iter().flat_map(|r| row_segments(r)).collect();
    // Merge segments into card columns: x-overlap AND vertically adjacent
    // (stacked wrapped lines), so distant text like the screen header stays
    // its own column and dies at the matcher. Segments arrive top-to-bottom.
    struct Column {
        left: i32,
        right: i32,
        bottom: i32,
        members: Vec<usize>,
    }
    let mut columns: Vec<Column> = Vec::new();
    for (i, seg) in segments.iter().enumerate() {
        let stack_limit = (MAX_STACK_GAP * (seg.bottom - seg.top).max(1) as f32) as i32;
        match columns.iter_mut().find(|c| {
            overlaps((c.left, c.right), (seg.left, seg.right)) && seg.top - c.bottom <= stack_limit
        }) {
            Some(c) => {
                c.left = c.left.min(seg.left);
                c.right = c.right.max(seg.right);
                c.bottom = c.bottom.max(seg.bottom);
                c.members.push(i);
            }
            None => columns.push(Column {
                left: seg.left,
                right: seg.right,
                bottom: seg.bottom,
                members: vec![i],
            }),
        }
    }
    columns.sort_by_key(|c| c.left);
    columns
        .into_iter()
        .map(|Column { mut members, .. }| {
            members.sort_by_key(|&i| segments[i].top);
            members
                .iter()
                .map(|&i| segments[i].text.clone())
                .filter(|t| !t.is_empty())
                .collect::<Vec<String>>()
        })
        .filter(|texts| !texts.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 30px-tall words, y = row top. Word-space gap ≈ 10px, card gap ≈ 100px.
    fn word(text: &str, left: i32, right: i32, top: i32) -> OcrWord {
        OcrWord {
            text: text.to_string(),
            left,
            right,
            top,
            bottom: top + 30,
        }
    }

    #[test]
    fn same_baseline_titles_split_at_card_gaps() {
        // The exact failure mode observed with OCR-level lines: four titles on
        // one baseline must come out as four cards, not one mega-line.
        let words = [
            word("FORMA", 0, 100, 10),
            word("BLUEPRINT", 110, 260, 10),
            word("BRATON", 400, 520, 10),
            word("PRIME", 530, 620, 10),
            word("STOCK", 630, 730, 10),
            word("2X", 900, 940, 10),
            word("FORMA", 950, 1050, 10),
        ];
        assert_eq!(
            group_into_cards(&words),
            ["FORMA BLUEPRINT", "BRATON PRIME STOCK", "2X FORMA"]
        );
    }

    #[test]
    fn wrapped_titles_join_within_a_card() {
        let words = [
            word("AKSTILETTO", 100, 260, 10),
            word("PRIME", 270, 350, 10),
            word("BARREL", 160, 280, 50),
            word("FORMA", 500, 610, 10),
            word("BLUEPRINT", 620, 780, 10),
        ];
        assert_eq!(
            group_into_cards(&words),
            ["AKSTILETTO PRIME BARREL", "FORMA BLUEPRINT"]
        );
    }

    #[test]
    fn cards_come_out_left_to_right_regardless_of_input_order() {
        let words = [word("BRATON", 700, 820, 12), word("FORMA", 50, 160, 10)];
        assert_eq!(group_into_cards(&words), ["FORMA", "BRATON"]);
    }

    #[test]
    fn slight_baseline_jitter_stays_one_row() {
        // OCR boxes wobble a few px; jitter below ROW_TOLERANCE×height must not
        // split a row (which would break the gap logic).
        let words = [
            word("BRATON", 0, 120, 10),
            word("PRIME", 130, 220, 14),
            word("STOCK", 230, 330, 7),
        ];
        assert_eq!(group_into_cards(&words), ["BRATON PRIME STOCK"]);
    }

    #[test]
    fn distant_header_does_not_merge_into_a_card() {
        // "SELECT A REWARD" floats far above the cards; even where it
        // x-overlaps a card column it must stay separate.
        let words = [
            word("SELECT", 400, 520, 10),
            word("REWARD", 540, 660, 10),
            word("BRATON", 380, 500, 250),
            word("PRIME", 510, 600, 250),
            word("STOCK", 440, 540, 290),
        ];
        // The header stays its own column (matcher junk) instead of polluting
        // the card text; column order is by left edge.
        assert_eq!(
            group_into_cards(&words),
            ["BRATON PRIME STOCK", "SELECT REWARD"]
        );
    }

    #[test]
    fn empty_input_is_fine() {
        assert!(group_into_cards(&[]).is_empty());
    }
}
