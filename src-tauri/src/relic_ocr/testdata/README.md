# relic_ocr fixtures

Reward-selection-screen images the `relic-ocr` end-to-end tests run against
(`cargo test --features relic-ocr`).

- `synthetic_reward_screen_1080p.png` — generated (not a game asset): four
  reward cards at real-screen geometry on a dark noisy 1920×1080 frame, two
  titles wrapped, plus a "SELECT A REWARD" header the matcher must reject.
  Proves the pipeline (band crop → ocrs → card grouping → vocabulary match);
  it does NOT prove robustness to Warframe's real font, UI themes, or HUD
  scaling.

Real captures (PNG screenshots of the actual reward screen — ideally several
UI themes, resolutions, and squad sizes) should be added here with a
`real_<resolution>_<theme>_<n>cards.png` name and a matching `#[test]` listing
the expected names. Capture with the game's screenshot key or Spectacle/Win+PrtSc,
full frame, no cropping.
