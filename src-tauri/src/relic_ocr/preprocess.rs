//! Image preparation between capture and OCR. Pure image→image, compiled
//! regardless of the `relic-ocr` feature so its tests always run.
//!
//! The reward-selection screen puts the up-to-4 reward cards in a horizontal row
//! around the upper-middle of the frame, with the part name at the top of each
//! card. We crop one generous band covering that region (no per-resolution card
//! geometry — the OCR engine's own text detection finds the lines within it),
//! then grayscale, contrast-stretch, and upscale small captures.

use image::{imageops, GrayImage, RgbaImage};

/// Vertical extent of the crop band, as fractions of frame height. Calibrated
/// against reward-screen fixtures; generous on purpose — non-reward text that
/// slips in is rejected by the closed-vocabulary matcher, while a name that gets
/// cut off is unrecoverable.
const BAND_TOP: f32 = 0.22;
const BAND_BOTTOM: f32 = 0.62;

/// Recognition quality drops on small glyphs; captures whose band is shorter
/// than this are doubled with a smooth filter first (1080p bands land ~430px).
const MIN_BAND_HEIGHT: u32 = 500;

/// Crop the reward band and normalize it for the OCR engine.
pub fn reward_band(frame: &RgbaImage) -> GrayImage {
    let (w, h) = frame.dimensions();
    let top = (h as f32 * BAND_TOP) as u32;
    let bottom = ((h as f32 * BAND_BOTTOM).ceil() as u32).clamp(top + 1, h);
    let band = imageops::crop_imm(frame, 0, top, w, bottom - top).to_image();
    let mut gray = imageops::grayscale(&band);
    stretch_contrast(&mut gray);
    if gray.height() < MIN_BAND_HEIGHT {
        gray = imageops::resize(
            &gray,
            gray.width() * 2,
            gray.height() * 2,
            imageops::FilterType::CatmullRom,
        );
    }
    gray
}

/// Linear contrast stretch anchored at the 2nd/98th intensity percentiles, so a
/// dim, semi-transparent card background doesn't compress the text contrast the
/// recognition model sees. Percentiles (not min/max) keep single hot/dead pixels
/// from neutering the stretch.
fn stretch_contrast(img: &mut GrayImage) {
    let mut hist = [0u32; 256];
    for p in img.pixels() {
        hist[p.0[0] as usize] += 1;
    }
    let total: u32 = img.width() * img.height();
    if total == 0 {
        return;
    }
    let clip = total / 50; // 2%
    let (mut lo, mut acc) = (0u8, 0u32);
    for (i, n) in hist.iter().enumerate() {
        acc += n;
        if acc > clip {
            lo = i as u8;
            break;
        }
    }
    let (mut hi, mut acc) = (255u8, 0u32);
    for (i, n) in hist.iter().enumerate().rev() {
        acc += n;
        if acc > clip {
            hi = i as u8;
            break;
        }
    }
    if hi <= lo {
        return;
    }
    let range = f32::from(hi - lo);
    for p in img.pixels_mut() {
        let v = f32::from(p.0[0].clamp(lo, hi) - lo);
        p.0[0] = (v / range * 255.0).round() as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn flat_frame(w: u32, h: u32, v: u8) -> RgbaImage {
        RgbaImage::from_pixel(w, h, Rgba([v, v, v, 255]))
    }

    #[test]
    fn band_covers_the_card_region_and_upscales_1080p() {
        let band = reward_band(&flat_frame(1920, 1080, 120));
        // 22%..62% of 1080 = 237..670 → 433 rows, doubled to 866.
        assert_eq!(band.width(), 1920 * 2);
        assert_eq!(band.height(), 866);
    }

    #[test]
    fn large_band_is_not_upscaled() {
        let band = reward_band(&flat_frame(2560, 1440, 120));
        assert_eq!(band.width(), 2560);
        assert!(band.height() >= MIN_BAND_HEIGHT);
    }

    #[test]
    fn contrast_is_stretched_to_full_range() {
        // Low-contrast text (90) on a dim card (60) must come out near-black/white.
        let mut frame = flat_frame(200, 200, 60);
        for x in 80..120 {
            for y in 90..110 {
                frame.put_pixel(x, y, Rgba([90, 90, 90, 255]));
            }
        }
        let band = reward_band(&frame);
        let (min, max) = band
            .pixels()
            .fold((255u8, 0u8), |(lo, hi), p| (lo.min(p.0[0]), hi.max(p.0[0])));
        assert_eq!(min, 0);
        assert_eq!(max, 255);
    }
}
