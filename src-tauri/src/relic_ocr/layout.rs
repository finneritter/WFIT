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

/// One recognized character with its bounding box — the raw material for
/// [`words_from_chars`].
#[derive(Debug, Clone)]
pub struct OcrChar {
    pub ch: char,
    pub left: i32,
    pub right: i32,
    pub top: i32,
    pub bottom: i32,
}

/// Break a word even WITHOUT a space character when the horizontal gap between
/// consecutive characters exceeds this × glyph height: the CTC recognizer
/// sometimes emits no space across a card gutter (live 2026-07-15: three
/// same-baseline titles fused into "Burston Prime BlueprintVasto Prime
/// BlueprintTipedo Prime Blueprint"), and a "word" spanning two cards defeats
/// all downstream geometry. In-word letter gaps run ~0.1×, word spaces ~0.3×,
/// gutters several ×.
const CHAR_SPLIT_GAP: f32 = 0.8;

/// Rebuild words from per-character geometry instead of trusting the
/// recognizer's space characters: split at whitespace AND at gutter-sized
/// horizontal gaps between consecutive characters.
pub fn words_from_chars(chars: impl IntoIterator<Item = OcrChar>) -> Vec<OcrWord> {
    let mut out: Vec<OcrWord> = Vec::new();
    let mut cur: Option<OcrWord> = None;
    for c in chars {
        if c.ch.is_whitespace() {
            out.extend(cur.take());
            continue;
        }
        let split = cur.as_ref().is_some_and(|w| {
            let height = w.height().max((c.bottom - c.top).max(1));
            (c.left - w.right) as f32 > CHAR_SPLIT_GAP * height as f32
        });
        if split {
            out.extend(cur.take());
        }
        match &mut cur {
            Some(w) => {
                w.text.push(c.ch);
                w.right = w.right.max(c.right);
                w.top = w.top.min(c.top);
                w.bottom = w.bottom.max(c.bottom);
            }
            None => {
                cur = Some(OcrWord {
                    text: c.ch.to_string(),
                    left: c.left,
                    right: c.right,
                    top: c.top,
                    bottom: c.bottom,
                });
            }
        }
    }
    out.extend(cur);
    out
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
/// each row ordered left-to-right. A word joins a row when its center is
/// within ROW_TOLERANCE×height of the row's MEAN center (not the last-added
/// word's — chained jitter must not bridge two real rows).
fn rows(words: &[OcrWord]) -> Vec<Vec<&OcrWord>> {
    let mut sorted: Vec<&OcrWord> = words.iter().collect();
    sorted.sort_by_key(|w| w.top + w.bottom); // by vertical center ×2

    struct Row<'a> {
        words: Vec<&'a OcrWord>,
        center_sum: f32,
        height_max: i32,
    }
    let mut rows: Vec<Row> = Vec::new();
    for word in sorted {
        let center = (word.top + word.bottom) as f32 / 2.0;
        match rows.last_mut() {
            Some(row)
                if {
                    let mean = row.center_sum / row.words.len() as f32;
                    (center - mean).abs() < ROW_TOLERANCE * row.height_max.max(word.height()) as f32
                } =>
            {
                row.center_sum += center;
                row.height_max = row.height_max.max(word.height());
                row.words.push(word);
            }
            _ => rows.push(Row {
                words: vec![word],
                center_sum: center,
                height_max: word.height(),
            }),
        }
    }
    let mut out: Vec<Vec<&OcrWord>> = rows.into_iter().map(|r| r.words).collect();
    for row in &mut out {
        row.sort_by_key(|w| w.left);
    }
    out
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

/// One card column with the geometry the card-slot filter needs: reward-card
/// titles share a text row, so the TOP segment's vertical center identifies
/// whether an unmatched column is an unreadable card or off-row junk.
#[derive(Debug)]
pub struct CardColumn {
    /// Segment texts, top to bottom.
    pub segments: Vec<String>,
    /// Vertical center of the topmost segment (band px).
    pub top_center: i32,
    /// Glyph height of the topmost segment.
    pub top_height: i32,
}

/// Like [`group_into_card_segments`] but keeps each column's top-segment
/// geometry for the card-slot filter in `relic_ocr::read_rewards`.
pub fn group_into_card_columns(words: &[OcrWord]) -> Vec<CardColumn> {
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
        .filter_map(|Column { mut members, .. }| {
            members.sort_by_key(|&i| segments[i].top);
            let texts: Vec<String> = members
                .iter()
                .map(|&i| segments[i].text.clone())
                .filter(|t| !t.is_empty())
                .collect();
            if texts.is_empty() {
                return None;
            }
            let top = &segments[members[0]];
            Some(CardColumn {
                segments: texts,
                top_center: (top.top + top.bottom) / 2,
                top_height: (top.bottom - top.top).max(1),
            })
        })
        .collect()
}

/// Each card's segment texts (top-to-bottom), cards left-to-right — sugar over
/// [`group_into_card_columns`] for callers that don't need geometry.
pub fn group_into_card_segments(words: &[OcrWord]) -> Vec<Vec<String>> {
    group_into_card_columns(words)
        .into_iter()
        .map(|c| c.segments)
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

    /// 30px-tall chars, `w` px wide each, laid out contiguously from `left`.
    fn chars_of(text: &str, left: i32, w: i32, top: i32) -> Vec<OcrChar> {
        text.chars()
            .enumerate()
            .map(|(i, ch)| OcrChar {
                ch,
                left: left + i as i32 * w,
                right: left + (i as i32 + 1) * w,
                top,
                bottom: top + 30,
            })
            .collect()
    }

    #[test]
    fn gutter_gap_splits_words_even_without_space_char() {
        // The live 2026-07-15 fusion: the recognizer emitted NO space across
        // the card gutter, so "Blueprint" + "Vasto" arrived as one character
        // stream. The gutter-sized gap between char boxes must split them.
        let mut chars = chars_of("Blueprint", 0, 20, 10); // ends at x=180
        chars.extend(chars_of("Vasto", 400, 20, 10)); // 220px gap ≫ 30px height
        let texts: Vec<String> = words_from_chars(chars)
            .into_iter()
            .map(|w| w.text)
            .collect();
        assert_eq!(texts, ["Blueprint", "Vasto"]);
    }

    #[test]
    fn space_chars_split_words_and_are_dropped() {
        let words = words_from_chars(chars_of("FORMA BLUEPRINT", 0, 20, 10));
        let texts: Vec<&str> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, ["FORMA", "BLUEPRINT"]);
        // Boxes hug the glyphs: FORMA = chars 0..5, BLUEPRINT = chars 6..15.
        assert_eq!((words[0].left, words[0].right), (0, 100));
        assert_eq!((words[1].left, words[1].right), (120, 300));
    }

    #[test]
    fn letter_and_word_space_gaps_stay_one_word() {
        // Gaps well under CHAR_SPLIT_GAP × height (30px → limit 24px) must not
        // split: kerning gaps (~3px) and even a word-space-sized hole (~10px)
        // without a space char stay fused — the matcher tolerates a missing
        // space, but a missed split loses whole cards.
        let chars = vec![
            OcrChar {
                ch: 'A',
                left: 0,
                right: 20,
                top: 10,
                bottom: 40,
            },
            OcrChar {
                ch: 'B',
                left: 23,
                right: 43,
                top: 10,
                bottom: 40,
            },
            OcrChar {
                ch: 'C',
                left: 53,
                right: 73,
                top: 10,
                bottom: 40,
            },
        ];
        let texts: Vec<String> = words_from_chars(chars)
            .into_iter()
            .map(|w| w.text)
            .collect();
        assert_eq!(texts, ["ABC"]);
    }

    #[test]
    fn jitter_chain_does_not_merge_two_rows() {
        // Three words whose centers step down by 0.5×height each: last-word
        // comparison chains them into one row; mean-center must keep the third
        // word (a full row below word 1) out once the mean anchors high.
        // 30px-tall words: tops 10, 25, 40 → centers 25, 40, 55.
        let words = [
            word("BRONCO", 0, 120, 10),
            word("PRIME", 130, 220, 25),
            word("BARREL", 230, 330, 40),
        ];
        // Mean after 2 words = 32.5; word 3 center 55 differs by 22.5 > 0.6×30.
        assert_eq!(
            group_into_cards(&words),
            ["BRONCO PRIME", "BARREL"],
            "third word must start a new row, not chain-merge"
        );
    }

    #[test]
    fn wrapped_lines_at_065_spacing_stay_two_rows_and_one_card() {
        // Tight line spacing just above ROW_TOLERANCE: line 2 top at 0.65×30 ≈ 20px
        // below line 1 top. Must stay two rows (else words interleave) but still
        // stack into one card column.
        let words = [
            word("AKSTILETTO", 100, 260, 10),
            word("PRIME", 270, 350, 10),
            word("BARREL", 160, 280, 30), // centers differ 20px > 0.6×30 = 18
        ];
        assert_eq!(group_into_cards(&words), ["AKSTILETTO PRIME BARREL"]);
    }

    #[test]
    fn card_columns_expose_top_segment_geometry() {
        // Two cards, one wrapped: top_center/top_height must describe the TOP
        // segment (the title row), not the whole column.
        let words = [
            word("AKSTILETTO", 100, 260, 10),
            word("PRIME", 270, 350, 10),
            word("BARREL", 160, 280, 50),
            word("FORMA", 500, 610, 10),
        ];
        let cols = group_into_card_columns(&words);
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].segments, ["AKSTILETTO PRIME", "BARREL"]);
        assert_eq!(cols[0].top_center, 25); // (10+40)/2
        assert_eq!(cols[0].top_height, 30);
        assert_eq!(cols[1].segments, ["FORMA"]);
        assert_eq!(cols[1].top_center, 25);
    }
}
