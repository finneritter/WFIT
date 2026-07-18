# WFIT: Warframe Item Tracker

Warframe has an active player-run trading economy but few tools for navigating it. Prices live on a
separate community site ([warframe.market](https://warframe.market)), the game itself never reports
what any of your thousands of tradeable items is worth, and there is no way to view your holdings as
a portfolio. As a result, most trading relies on guesswork and a stack of browser tabs.

WFIT addresses this gap. It is a desktop application that tracks what you own, prices it against live
warframe.market data in real time, and answers three questions that no existing tool answers well:
what is your inventory actually worth, what should you sell, and what is underpriced right now. In
short, it functions as a trading terminal for a game economy, combining a portfolio view and a
market screener in one place.

The application began as a React and Supabase web app and was later rebuilt to remove the cloud
backend, which added maintenance overhead with little benefit for what is fundamentally a
single-user tool. It now ships as a single binary with a local SQLite database. There is no account,
no server, and nothing is uploaded anywhere.

It runs on Linux and Windows (macOS builds from source). The core is written in Rust via Tauri 2
with a React frontend and a dense, monochrome "trading terminal" interface.

![WFIT home dashboard](docs/screenshots/home.png)

<details>
<summary><b>More screenshots</b>: inventory, relics, rivens, trends, vendors, rotation, arcanes</summary>
<br>

| | |
|---|---|
| **Inventory**: realizable portfolio value ![Inventory](docs/screenshots/inventory.png) | **Relics**: full-catalog browser with squad EV ![Relics](docs/screenshots/relics.png) |
| **Riven Search**: auction screener and value estimator ![Riven Search](docs/screenshots/riven-search.png) | **Trends**: market index and your movers ![Trends](docs/screenshots/trends.png) |
| **Vendors**: Baro, Varzia, Teshin, Circuit, Nora, and syndicate shops ![Vendors](docs/screenshots/vendors.png) | **Rotation**: fissures, cycles, arbitrations ![Rotation](docs/screenshots/rotation.png) |
| **Arcanes**: Vosfor dissolution math ![Arcanes](docs/screenshots/arcanes.png) | |

</details>

## Download

Download the latest installer from **[Releases](../../releases/latest)**:

| OS | File | Notes |
|---|---|---|
| Windows | `WFIT_x.y.z_x64-setup.exe` (or the `.msi`) | Currently unsigned, so SmartScreen will warn. Select More info, then Run anyway. |
| Linux (any distro) | `WFIT_x.y.z_amd64.AppImage` | `chmod +x` and run. Requires `webkit2gtk-4.1`. |
| Debian / Ubuntu | `WFIT_x.y.z_amd64.deb` | `sudo apt install ./WFIT_*.deb` |
| Fedora / RHEL | `WFIT-x.y.z-1.x86_64.rpm` | `sudo dnf install ./WFIT-*.rpm` |
| Arch | AppImage, or build from source | `scripts/install.sh` builds and installs a native binary. |
| macOS | build from source | `npm run tauri build` on a Mac. |

This is an independent project maintained by one developer. It is developed and used primarily on
Linux; if you encounter a problem, please [open an issue](../../issues).

On first launch, the application builds its item catalog from warframe.market and prices it in the
background. All requests are rate-limited to roughly 2.5 per second to respect the API, so the
initial sync takes some time. The badge in the top bar indicates how current the data is. After the
initial sync, everything except live prices and world state works offline.

Windows installers and Linux AppImages update themselves. A daily check offers new versions in
Settings, About; downloads are signed and nothing installs without your confirmation. The deb and
rpm installers instead display a notification pointing back to this page.

> **Warning:** One feature requires an explicit warning. The opt-in
> [game inventory import](#game-inventory-import) reads the running Warframe client's memory to
> import your true owned counts. This **violates Digital Extremes' Terms of Service and could result
> in an account ban**. It is off by default, gated behind a typed consent phrase, and fully isolated
> from the rest of the application; every other feature communicates only with public APIs.

## What it does

- **Inventory**: your items in a dense tile grid, valued per rank for mods and arcanes, with price
  sparklines, vault status, and a per-item drawer (candlestick chart, bid ladder, rank breakdown,
  and sell/adjust actions).
- **Relics**: every relic in the game in one sortable table, including expected platinum and ducats
  per crack, computed correctly for radshares (a best-of-four run is not four times the solo
  average), the gold drop's price, vaulted and buyable-from-Varzia tags, a do-not-burn flag, and a
  per-relic view showing which drops you already own and whether refining pays for its traces.
- **Riven search**: the warframe.market auction house with a stat picker, per-stat thresholds, and a
  price estimator that flags underpriced listings.
- **Trends**: a market index over the liquid portion of the catalog, plus buy, sell, and
  unusual-volume signals scored against each item's own trading history.
- **Sets, Ducats, Arcanes**: set completion and finishing costs, ducats-per-platinum ranking for
  Baro preparation, and an assessment of whether each arcane is worth more sold or dissolved into
  Vosfor.
- **Rotation and Vendors**: fissures verified against Digital Extremes' own worldstate feed,
  locally computed world cycles, an arbitration schedule with community node grades, and a check-off
  board for Baro, Varzia, Teshin, the Circuit, and Nora's shop with market values attached, plus a
  Syndicates tab pricing all six relay syndicates' tradeable stock in platinum per standing.
- **Listings and sales**: mirrors your live warframe.market sell orders (read-only) and keeps a
  ledger of what you have sold.
- **Watchlist and buy list**: target prices that flip a badge when the market crosses them, and a
  budgeted shopping list.
- **Home dashboard**: a customizable widget board covering portfolio value, movers, watchlist hits,
  and world cycles, along with a tracked-resources widget that surfaces the materials you pin (steel
  essence, aya, kuva, tau shards, and similar) at a glance.
- **In-game overlays**: two optional, always-on-top HUD windows toggled by global hotkey. The first
  is a Void Cascade timer pill; the second is a relic-crack price box (**Alt+T** on the reward
  screen) that reads the four drop names by OCR and displays their market prices, allowing you to
  choose the most valuable reward without alt-tabbing out of the game.

The top-bar search works on every screen with a DIM-style query language, supporting expressions
such as `is:vaulted`, `rare>30`, `drops:nova`, and `ducats>45`, alongside standard filters.

## The valuation model

The valuation model is the core of the application and the primary reason it exists. A market price
is a *marginal* price, meaning the price at which one additional unit sells. Multiplying it by your
stack size substantially overvalues large holdings: 500 copies of a mod that trades twice a week are
not worth 500 times its listed price.

WFIT therefore computes a **realizable** value and presents that as the headline figure:

- Prime parts and single copies retain full value, because they are liquid and readily sold.
- Multi-copy mod and arcane stacks are liquidated on paper: units are sold into the live buy orders,
  best bid first, and then into a volume-capped, discounted tail. Copies beyond genuine demand are
  valued at close to nothing, which reflects reality.
- Low-value items can be excluded (by rarity or a per-category price floor) so they do not distort
  the total.
- Each valuation carries a confidence grade and an estimated time to sell.

Prices themselves prefer the live order book (the median of the five cheapest online asks) over
trade medians, are winsorized against outlier trades, clamp isolated inflated asks, and are computed
per rank, since a rank-0 arcane and a maxed one are distinct goods. A background process re-prices
the stalest data every 45 seconds, watchlist first, so figures remain current throughout a session.

## Connecting your warframe.market account

This is optional and used by the Listings screen. Two tiers are available, both read-only: username
only (which mirrors your public orders), or a pasted JWT stored in the operating system keychain for
account status. No password is ever handled by the application, and there is no Digital Extremes
login anywhere.

## Game inventory import

Settings, Game inventory can read your real owned counts from the running game client, which is the
one data point no public API provides. As noted above, **this violates Digital Extremes' Terms of
Service and carries a risk of an account ban**. It is opt-in, gated behind typed consent, and never
logs in; it reads the session the game already holds. It is available on Linux and Windows only, as
macOS's System Integrity Protection blocks cross-process reads. Details are in
`docs/GAME_INVENTORY_IMPORT.md`.

The session-reuse technique is a native Rust reimplementation of the approach pioneered by
[gjrud/warframe-helper](https://github.com/gjrud/warframe-helper) and
[Sainan/warframe-api-helper](https://github.com/Sainan/warframe-api-helper), with credit to both for
working it out and for the typed-consent pattern this mirrors.

## Building it yourself

```bash
npm install
npm run tauri:dev           # dev app (Vite + Rust)
npm run build               # typecheck + production build
scripts/install.sh          # optimized local build, installed as a desktop app
```

Linux requires `webkit2gtk-4.1`. The WebKitGTK and Wayland rendering workarounds are set inside
`main()`, so no wrapper script is needed.

Checks: `npm run lint` (Biome) for the frontend, and `cargo fmt && cargo clippy && cargo test` in
`src-tauri/`. The Rust tests cover the pricing and valuation logic, relic EV, worldstate parsing,
and the derived world-cycle clocks.

Your database is stored at `$APPDATA/dev.finn.wfit/wfit.sqlite` (on Linux,
`~/.local/share/dev.finn.wfit/`). A snapshot is taken automatically before any schema migration, and
Settings, Backups can create additional snapshots.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the system overview; start here.
- [`docs/FEATURE_PLAYBOOK.md`](docs/FEATURE_PLAYBOOK.md): conventions for adding a feature.
- [`docs/DATA_SOURCING_MASTER_PLAN.md`](docs/DATA_SOURCING_MASTER_PLAN.md): the warframe.market data contract.
- [`docs/GAMESTATE_WORLDSTATE.md`](docs/GAMESTATE_WORLDSTATE.md): world-state sources and the derived cycle clocks.
- [`docs/ARCANE_DISSOLUTION.md`](docs/ARCANE_DISSOLUTION.md): the Vosfor methodology.
- [`docs/ROTATION_PAGE_DESIGN.md`](docs/ROTATION_PAGE_DESIGN.md): the visual design language.
- [`CHANGELOG.md`](CHANGELOG.md): release notes.

## License

Proprietary. Copyright (c) 2026 Finn Ellis. All rights reserved. See [`LICENSE`](LICENSE).
