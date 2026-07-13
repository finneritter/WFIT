//! Relic-crack price capture (issue #2): screenshot the reward-selection screen,
//! OCR the offered part names, price them from the local caches, and show a
//! Warframe-HUD-styled overlay. Isolated from the market path like `gamescan`/
//! `worldstate` — **zero warframe.market calls happen at capture time**; pricing
//! reads reuse the same preloaded maps as the Relics browser.
//!
//! ToS note: this is the WFInfo approach — a one-off screenshot read locally, no
//! injection, no memory reads, no game files touched beyond (optionally) tailing
//! the EE.log text file. DE has publicly tolerated this class of tool for years.

pub mod matching;
