# WFIT — Warframe Item Tracker

A desktop app for Warframe traders. It tracks what you own, prices it against live
[warframe.market](https://warframe.market) data, and tells you the things I always wanted a tool
to tell me: provides the user with real time price information and a more streamlined method for buying and selling items.

I originally built this as a React + Supabase web app, then got tired of maintaining a cloud
backend for what is fundamentally a single-player tool. So it's now one binary and one SQLite
file on your disk. No account, no server, nothing uploaded anywhere.

Runs on Linux and Windows (macOS builds from source). Rust core via Tauri 2, React frontend,
dense monochrome "trading terminal" look.

![WFIT home dashboard](docs/screenshots/home.png)

<details>
<summary><b>More screenshots</b> — inventory, relics, rivens, trends, vendors, rotation, arcanes</summary>
<br>

| | |
|---|---|
| **Inventory** — realizable portfolio value ![Inventory](docs/screenshots/inventory.png) | **Relics** — full-catalog browser with squad EV ![Relics](docs/screenshots/relics.png) |
| **Riven Search** — auction screener + value estimator ![Riven Search](docs/screenshots/riven-search.png) | **Trends** — market index + your movers ![Trends](docs/screenshots/trends.png) |
| **Vendors** — Baro/Varzia/Teshin/Circuit/Nora check-off ![Vendors](docs/screenshots/vendors.png) | **Rotation** — fissures, cycles, arbitrations ![Rotation](docs/screenshots/rotation.png) |
| **Arcanes** — Vosfor dissolution math ![Arcanes](docs/screenshots/arcanes.png) | |

</details>

## Download

Grab the latest installer from **[Releases](../../releases/latest)**:

| OS | File | Notes |
|---|---|---|
| Windows | `WFIT_x.y.z_x64-setup.exe` (or the `.msi`) | Unsigned for now, so SmartScreen will warn — More info → Run anyway. |
| Linux (any distro) | `WFIT_x.y.z_amd64.AppImage` | `chmod +x` and run. Needs `webkit2gtk-4.1`. |
| Debian / Ubuntu | `WFIT_x.y.z_amd64.deb` | `sudo apt install ./WFIT_*.deb` |
| Fedora / RHEL | `WFIT-x.y.z-1.x86_64.rpm` | `sudo dnf install ./WFIT-*.rpm` |
| Arch | AppImage, or build from source | `scripts/install.sh` builds and installs a native binary. |
| macOS | build from source | `npm run tauri build` on a Mac. |

This is a one-person hobby project. I daily-drive it on Linux, but if you hit something broken,
please [open an issue](../../issues).

On first launch the app builds its item catalog from warframe.market and prices it in the
background. All requests are rate-limited to ~2.5/s to be a polite API citizen, so the initial
sync takes a while — the badge in the topbar shows how fresh the data is. After that, everything
except live prices and world state works offline.

Windows installs and Linux AppImages update themselves (a daily check offers new versions in
Settings → About; downloads are signed and nothing installs without your click). deb/rpm installs
just get a notification pointing back here.

> ⚠️ One feature needs a real warning: the opt-in [game inventory import](#game-inventory-import)
> reads the running Warframe client's memory to import your true owned counts. That **violates
> DE's Terms of Service and could get your account banned**. It's off by default, behind a typed
> consent phrase, and fully isolated from the rest of the app — everything else only talks to
> public APIs.

## What it does

- **Inventory** — your items in a dense tile grid, valued per rank for mods and arcanes, with
  price sparklines, vault status, and a drawer per item (candlestick chart, bid ladder, rank
  breakdown, sell/adjust actions).
- **Relics** — every relic in the game in one sortable table: expected plat and ducats per crack,
  computed properly for radshares (best-of-4 is not 4× the solo average), the gold drop's price,
  vaulted/buyable-from-Varzia tags, a do-not-burn flag, and a per-relic view showing which drops
  you already own and whether refining pays for its traces.
- **Riven search** — the warframe.market auction house with a stat picker, per-stat thresholds,
  and a price estimator that flags underpriced listings.
- **Trends** — a market index over the liquid part of the catalog, plus buy/sell/unusual-volume
  signals scored against each item's own trading history.
- **Sets, Ducats, Arcanes** — set completion and finish-costs; ducats-per-plat ranking for Baro
  prep; whether each arcane is worth more sold or dissolved into Vosfor.
- **Rotation & Vendors** — fissures verified against DE's own worldstate feed, locally-computed
  world cycles, arbitration schedule with community node grades, and a check-off board for
  Baro / Varzia / Teshin / the Circuit / Nora's shop with market values attached.
- **Listings & sales** — mirrors your live warframe.market sell orders (read-only), and keeps a
  ledger of what you actually sold.
- **Watchlist & buy list** — target prices that flip a badge when the market crosses them, and a
  budgeted shopping list.

The topbar search works on every screen with a DIM-style query language — things like
`is:vaulted`, `rare>30`, `drops:nova`, `ducats>45` — alongside regular filters.

## The valuation model

This is the part I care most about, and the reason the app exists. A market price is a *marginal*
price — what one more unit sells for. Multiplying it by your stack size wildly overvalues hoards:
500 copies of a mod that trades twice a week are not worth 500× its sticker price.

So WFIT computes a **realizable** value and headlines that instead:

- Prime parts and single copies keep full value — they're liquid, someone will buy them.
- Multi-copy mod/arcane stacks get liquidated on paper: units are sold into the live buy orders
  best-bid-first, then into a volume-capped, discounted tail. Copies beyond real demand are worth
  roughly nothing, which is the honest answer.
- Junk can be excluded (by rarity or a per-category price floor) so it stops polluting the total.
- Each valuation carries a confidence grade and an estimated days-to-sell.

Prices themselves prefer the live order book (median of the five cheapest online asks) over trade
medians, are winsorized against fat-finger trades, clamp lone troll asks, and are computed per
rank — a rank-0 arcane and a maxed one are different goods. A background heartbeat re-prices the
stalest data every 45 seconds, watchlist first, so numbers stay current all session.

## Connecting your warframe.market account

Optional, for the Listings screen. Two tiers, both read-only: username only (mirrors your public
orders), or a pasted JWT stored in the OS keychain for account status. No password ever touches
the app, and there is no DE login anywhere.

## Game inventory import

Settings → Game inventory can read your real owned counts from the running game client, which is
the one thing no public API provides. Again: **this is against DE's ToS and is ban-risk** — it's
opt-in, typed-consent-gated, and never logs in (it reads the session the game already has).
Linux and Windows only; macOS's SIP blocks cross-process reads. Details in
`docs/GAME_INVENTORY_IMPORT.md`.

## Building it yourself

```bash
npm install
npm run tauri:dev           # dev app (Vite + Rust)
npm run build               # typecheck + production build
scripts/install.sh          # optimized local build, installed as a desktop app
```

Linux needs `webkit2gtk-4.1`. The WebKitGTK/Wayland rendering workarounds are set inside `main()`,
so no wrapper script is needed.

Checks: `npm run lint` (Biome) for the frontend; `cargo fmt && cargo clippy && cargo test` in
`src-tauri/`. The Rust tests cover the pricing and valuation math, relic EV, worldstate parsing,
and the derived world-cycle clocks.

Your database lives at `$APPDATA/dev.finn.wfit/wfit.sqlite` (on Linux:
`~/.local/share/dev.finn.wfit/`). A snapshot is taken automatically before any schema migration,
and Settings → Backups can make more.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the system overview; start here.
- [`docs/FEATURE_PLAYBOOK.md`](docs/FEATURE_PLAYBOOK.md) — conventions for adding a feature.
- [`docs/DATA_SOURCING_MASTER_PLAN.md`](docs/DATA_SOURCING_MASTER_PLAN.md) — the warframe.market data contract.
- [`docs/GAMESTATE_WORLDSTATE.md`](docs/GAMESTATE_WORLDSTATE.md) — world-state sources and the derived cycle clocks.
- [`docs/ARCANE_DISSOLUTION.md`](docs/ARCANE_DISSOLUTION.md) — the Vosfor methodology.
- [`docs/ROTATION_PAGE_DESIGN.md`](docs/ROTATION_PAGE_DESIGN.md) — the visual design language.
- [`CHANGELOG.md`](CHANGELOG.md) — release notes.

## License

Proprietary — Copyright (c) 2026 Finn Ellis. All rights reserved. See [`LICENSE`](LICENSE).
