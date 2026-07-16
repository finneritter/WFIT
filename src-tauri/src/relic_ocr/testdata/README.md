# relic_ocr fixtures

Reward-selection-screen images the `relic-ocr` end-to-end tests run against
(`cargo test --features relic-ocr`).

- `synthetic_reward_screen_1080p.png` — generated (not a game asset): four
  reward cards at real-screen geometry on a dark noisy 1920×1080 frame, two
  titles wrapped, plus a "SELECT A REWARD" header the matcher must reject.
  Proves the pipeline (band crop → ocrs → card grouping → vocabulary match);
  it does NOT prove robustness to Warframe's real font, UI themes, or HUD
  scaling.

- `real_reward_screen_1440p_hover_band.png` — real 4-player capture
  (2026-07-15), stored as the PREPROCESSED band (grayscale, contrast-stretched
  — `preprocess::reward_band` output) to keep the repo lean; feed it straight
  to `ocr::words`. The third card's title wraps to two lines and is hovered,
  so the game's tooltip panel + a squadmate name row pollute its layout
  column — the live "only some rewards detected" bug. Regression for
  segment-run (window) matching.

Real captures (PNG screenshots of the actual reward screen — ideally several
UI themes, resolutions, and squad sizes) should be added here with a matching
`#[test]` listing the expected names. Capture with the game's screenshot key or
Spectacle/Win+PrtSc, full frame, no cropping — or take `last-frame.png` from
`$APPDATA/wfit/relic-ocr-debug/`. To convert a full frame into a lean band
fixture: `WFIT_OCR_FRAME=frame.png WFIT_OCR_BAND_OUT=band.png cargo test
--features relic-ocr pipeline_reads_env_frame -- --ignored --nocapture`.
