//! The ocrs engine wrapper (feature `relic-ocr`). Models are embedded from
//! `resources/ocr/` (CC-BY-SA-4.0, see the README there) so the app works
//! offline and `cargo test --features relic-ocr` never downloads anything.
//!
//! Engine construction costs ~100ms (model deserialization), so it lives in a
//! `OnceCell` and [`warm`] is called at startup when the feature is enabled in
//! prefs — the first hotkey press mustn't pay it.

use image::GrayImage;
use ocrs::{ImageSource, OcrEngine, OcrEngineParams, TextItem};
use once_cell::sync::OnceCell;
use rten::Model;

use super::layout::OcrWord;

const DETECTION_MODEL: &[u8] = include_bytes!("../../resources/ocr/text-detection.rten");
const RECOGNITION_MODEL: &[u8] = include_bytes!("../../resources/ocr/text-recognition.rten");

/// Recognized lines shorter than this are engine noise, not words.
const MIN_TEXT_LEN: usize = 2;

static ENGINE: OnceCell<OcrEngine> = OnceCell::new();

fn engine() -> Result<&'static OcrEngine, String> {
    ENGINE.get_or_try_init(|| {
        let detection = Model::load_static_slice(DETECTION_MODEL)
            .map_err(|e| format!("load detection model: {e}"))?;
        let recognition = Model::load_static_slice(RECOGNITION_MODEL)
            .map_err(|e| format!("load recognition model: {e}"))?;
        OcrEngine::new(OcrEngineParams {
            detection_model: Some(detection),
            recognition_model: Some(recognition),
            ..Default::default()
        })
        .map_err(|e| format!("build OCR engine: {e}"))
    })
}

/// Deserialize the models ahead of the first capture. Errors are returned (and
/// logged by the caller) but never fatal — the capture path re-reports them.
#[allow(dead_code)] // called at startup once prefs land (prefs stage)
pub fn warm() -> Result<(), String> {
    engine().map(|_| ())
}

/// Run detection + recognition on a preprocessed band and return every
/// recognized WORD with its bounding box (band pixel coordinates). Words, not
/// the engine's lines: ocrs merges same-baseline text across the card gutters,
/// so card segmentation is done by `layout` from word geometry instead.
pub fn words(band: &GrayImage) -> Result<Vec<OcrWord>, String> {
    let engine = engine()?;
    let source = ImageSource::from_bytes(band.as_raw(), band.dimensions())
        .map_err(|e| format!("image source: {e}"))?;
    let input = engine
        .prepare_input(source)
        .map_err(|e| format!("prepare input: {e}"))?;
    let word_rects = engine
        .detect_words(&input)
        .map_err(|e| format!("detect words: {e}"))?;
    let line_rects = engine.find_text_lines(&input, &word_rects);
    let texts = engine
        .recognize_text(&input, &line_rects)
        .map_err(|e| format!("recognize text: {e}"))?;
    Ok(texts
        .iter()
        .flatten()
        .flat_map(|line| line.words())
        .filter(|w| w.to_string().trim().len() >= MIN_TEXT_LEN)
        .map(|w| {
            let rect = w.bounding_rect();
            OcrWord {
                text: w.to_string(),
                left: rect.left(),
                right: rect.right(),
                top: rect.top(),
                bottom: rect.bottom(),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_load_and_engine_builds() {
        warm().expect("embedded models must deserialize");
    }
}
