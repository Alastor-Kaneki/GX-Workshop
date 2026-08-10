# GX Workshop

**GX Workshop** is an unofficial, local-first web superclient for Opera GX mods: browse, search, archive, inspect, download, theme, and eventually remix/build GX packages from one responsive PWA.

## What is in the first foundation

- **Mobile + desktop/laptop first-class UI** — desktop sidebar/workspace, mobile bottom navigation, touch-sized controls, adaptive grids and responsive detail views.
- **GX catalog browser** — local full-text search across mod name, author, description, tags and components; filters; sorting; random discovery; GX Store URL resolver.
- **Scheduled catalog sync** — GitHub Actions crawls public **official GX Store pages** and writes `data/catalog.json`, avoiding browser-side CORS scraping for discovery.
- **GX package resolver** — inherited from the earlier GX Mod Archive Downloader logic. It recognizes both `mods.store.gx.me` and legacy `play.gxc.gg` layouts and derives the sibling `mod.crx` from GX asset URLs.
- **Downloads** — direct original CRX downloads and CRX2/CRX3 → raw ZIP payload extraction in-browser when the GX CDN permits CORS. If ZIP conversion is blocked, the UI falls back to the original CRX.
- **Local library** — favorites, saved/downloaded mods, download history and archive imports stored in IndexedDB.
- **Workbench** — drag/drop `.crx` or `.zip`, SHA-256 fingerprinting, CRX version detection, ZIP payload offset detection and raw ZIP extraction.
- **GX Theme Lab** — whole-interface theme families, accent/secondary/background controls, glow/radius mutation, theme randomization, image palette extraction and CSS-variable-driven coverage.
- **Asset-driven theming architecture** — an imported GX image is treated as a *theme seed*, not just an icon replacement. The next pack milestone is automatic CRX/ZIP asset-pack enumeration so each GX icon creates a complete style preset.
- **PWA** — installable manifest, service-worker app-shell caching and standalone layout support.
- **Settings + diagnostics** — source status, feature capability report, visual effects, reduced motion, backup/restore and local reset.
- **Chaos Mode** — because of course.

## Why the catalog is synchronized

GX Workshop is designed to remain GitHub Pages compatible. A normal web page cannot safely assume it can scrape `store.gx.me` cross-origin. The `sync-catalog.yml` Action does discovery server-side on GitHub's runner, then the site loads a static catalog from its own origin.

The source store remains the authority. Every catalog record preserves its official GX Store URL.

## Package URL discovery

GX Store pages load package assets from domains such as:

- `https://mods.store.gx.me/mods/...`
- `https://play.gxc.gg/mods/...` (legacy)

Those assets live alongside `mod.crx`. `scripts/sync-catalog.mjs` scans official detail HTML for public GX package asset URLs and normalizes them into the direct package URL. The resolver intentionally accepts both 3/4+ segment package layouts because GX has used more than one layout.

## GitHub Pages

The repo contains `.github/workflows/pages.yml`.

If needed, open **Settings → Pages** and choose **GitHub Actions** as the Pages source. Pushes to `main` then deploy GX Workshop automatically.

## Catalog sync

`.github/workflows/sync-catalog.yml` runs every six hours and can be run manually.

Configuration:

- `MAX_PAGES` — number of list pages crawled for each sort mode.
- `DETAIL_LIMIT` — maximum detail pages resolved per run.

The sync intentionally rate-limits requests and retries temporary failures instead of hammering GX Store.

## Privacy / safety

- Imported archives are processed locally.
- GX Workshop does **not execute JavaScript from imported mods**.
- Library/history/settings live locally in IndexedDB.
- Local data can be exported or cleared from Settings.
- The browser app does not require an account.

## Direction

The architecture is deliberately split into modules so “moar” does not become “broken.” Planned systems fit around the same core:

- archive file-tree explorer
- manifest editor, validator and diff viewer
- image/audio/font/video previews
- component extraction/replacement
- custom mod builder and mixer
- loadouts and collections
- asset-pack → multi-theme generator
- custom theme package format
- local search indexes and smart collections
- compatibility/conflict analysis
- preservation bundles
- offline collection packs
- local/LAN transfer
- optional edge/companion networking adapter for operations browsers cannot perform directly
- source adapters and diagnostics
- creator tools, optimization and batch operations

GX Workshop is unofficial and is not affiliated with Opera Software.
