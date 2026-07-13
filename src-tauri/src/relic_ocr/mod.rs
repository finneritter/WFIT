//! Relic-crack price capture (issue #2): screenshot the reward-selection screen,
//! OCR the offered part names, price them from the local caches, and show a
//! Warframe-HUD-styled overlay. Isolated from the market path like `gamescan`/
//! `worldstate` — **zero warframe.market calls happen at capture time**; pricing
//! reads reuse the same preloaded maps as the Relics browser.
//!
//! ToS note: this is the WFInfo approach — a one-off screenshot read locally, no
//! injection, no memory reads, no game files touched beyond (optionally) tailing
//! the EE.log text file. DE has publicly tolerated this class of tool for years.

pub mod layout;
pub mod matching;
#[cfg(feature = "relic-ocr")]
pub mod ocr;
pub mod preprocess;

/// Preprocessed band → OCR → card grouping → closed-vocabulary matching.
/// The file-based and live-capture paths both funnel through here.
#[cfg(feature = "relic-ocr")]
pub fn read_rewards(frame: &image::RgbaImage) -> Result<Vec<matching::LineMatch>, String> {
    let band = preprocess::reward_band(frame);
    let words = ocr::words(&band)?;
    let cards = layout::group_into_cards(&words);
    let vocab = matching::build_vocab();
    Ok(matching::match_lines(&vocab, &cards, 4))
}

#[cfg(all(test, feature = "relic-ocr"))]
mod tests {
    use super::*;

    /// Full pipeline over the committed synthetic reward screen: 1080p frame,
    /// four cards, two titles wrapped onto a second line, plus a "SELECT A
    /// REWARD" header the matcher must reject. Real-game fixtures (themes,
    /// scaling) join this as they're captured; see testdata/README.md.
    #[test]
    fn synthetic_reward_screen_reads_all_four_cards() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/relic_ocr/testdata/synthetic_reward_screen_1080p.png"
        );
        let frame = image::open(path).expect("fixture loads").into_rgba8();
        let matches = read_rewards(&frame).expect("pipeline runs");
        let names: Vec<&str> = matches.iter().map(|m| m.display_name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Akstiletto Prime Barrel",
                "Braton Prime Stock",
                "Forma Blueprint",
                "2X Forma Blueprint"
            ],
            "expected the four card titles, left to right"
        );
        for m in &matches {
            assert!(
                m.confidence >= matching::MIN_CONFIDENCE,
                "{} matched below the confidence floor",
                m.display_name
            );
        }
    }
}
