# TallyNest Media & GIF Capture Guide

This guide documents the creation, encoding, optimization, and reproducibility of the visual media assets used in the TallyNest README.

The README features a dedicated typographic animated header, an animated application preview montage, four genuine workflow recordings of browser interactions with the live React frontend and Express/MongoDB backend, a curated screenshot gallery, and a comprehensive system architecture diagram.

---

## Published Media Assets

| Asset                                  | Dimensions | Duration / decoded frames | Size     | Content                                                |
| -------------------------------------- | ---------- | ------------------------- | -------- | ------------------------------------------------------ |
| `docs/media/tallynest-header.gif`      | 900 × 220  | 5.20 s / 78               | 0.52 MiB | Readable branding and ambient glow                     |
| `docs/media/tallynest-preview.gif`     | 840 × 540  | 14.00 s / 84              | 1.15 MiB | Six genuine application screenshots                    |
| `docs/media/transaction-workflow.gif`  | 1000 × 625 | 8.76 s / 70               | 1.96 MiB | Expense creation and ledger filters                    |
| `docs/media/budgets-workflow.gif`      | 1000 × 625 | 7.38 s / 59               | 2.54 MiB | Two monthly category budgets                           |
| `docs/media/recurring-workflow.gif`    | 1000 × 625 | 5.26 s / 42               | 1.58 MiB | Monthly recurring schedule creation                    |
| `docs/media/groups-cycle-workflow.gif` | 1000 × 625 | 12.13 s / 97              | 4.93 MiB | Single-owner cycle creation, expense, freeze and close |
| `docs/media/architecture.svg`          | 960 × 620  | Vector                    | 0.01 MiB | Application topology and persistence invariants        |

---

## Published Screenshot Gallery

All screenshots are stored in `docs/screenshots/` and captured directly from the running application:

| Screenshot Asset                           | Viewport Size  | Captured Interface                                                                 |
| ------------------------------------------ | -------------- | ---------------------------------------------------------------------------------- |
| `docs/screenshots/dashboard.png`           | 1440 × 1594 px | Financial Overview Dashboard, Cash Flow summary, Category distribution charts      |
| `docs/screenshots/transactions-ledger.png` | 1440 × 1039 px | Personal Transaction Ledger with multi-criteria filtering and cursor pagination    |
| `docs/screenshots/budget-management.png`   | 1440 × 1650 px | Monthly Category Budgets with spending threshold progress indicators               |
| `docs/screenshots/recurring-schedules.png` | 1440 × 1108 px | Recurring Transactions Engine with active schedules and upcoming execution dates   |
| `docs/screenshots/group-workspace.png`     | 1440 × 1414 px | Collaborative Group Workspace, member lists, invitations, and cycle sections       |
| `docs/screenshots/shared-expenses.png`     | 1440 × 900 px  | Shared Expense Creation Modal featuring Equal, Exact, and Percentage split rules   |
| `docs/screenshots/balances-settlement.png` | 1440 × 1930 px | Debt Simplification Matrix, settlement proposals, and confirmed zero-balance state |
| `docs/screenshots/cycle-workspace.png`     | 1440 × 900 px  | Financial Cycle Lifecycle Workspace showing active cycle states and navigation     |
| `docs/screenshots/mobile-responsive.png`   | 390 × 2186 px  | Mobile Dashboard layout with bottom sheet drawer and stacked card components       |
| `docs/screenshots/financial-recovery.png`  | 1440 × 1811 px | Authorized Financial Recovery drill interface for interrupted operations           |

---

## Safe Reproduction Procedure

All demonstrations use **disposable local databases** created on the fly with the prefix `tallynest_fresh_v2_test_<timestamp>_<hex>`. No production or hosted database is ever modified or queried.

### 1. Prerequisites

- Linux x64 or macOS
- Node.js 24 LTS and npm
- Installed backend/frontend dependencies (`npm run install:ci`) and Playwright Chromium (`cd frontend && npx playwright install chromium`)
- Docker with healthy MongoDB 8.0 running locally (`docker compose up -d --wait mongodb`)
- FFmpeg 6.0+ and ImageMagick 7 (`magick`)
- Python 3 with Pillow (`python3 -c "import PIL"`)

### 2. Generate the Animated Typographic Header

```bash
node dev/generate-header-gif.js
```

This launches headless Chromium to render the HTML/CSS/SVG canvas at 15 FPS using `@fontsource-variable/manrope`, keeps branding readable throughout the loop, exports frame PNGs, generates a custom 96-color palette via FFmpeg, applies Bayer dithering, and optimizes layers via ImageMagick. Output: `docs/media/tallynest-header.gif`.

### 3. Generate the Application Preview Montage

```bash
python3 dev/generate-preview-gif.py
```

This reads the six permanent screenshots in `docs/screenshots/` (not ignored `output/` captures), extracts viewport crops, applies floating status pills with mint indicators, executes smooth crossfades between views, and optimizes the GIF with FFmpeg and ImageMagick. Output: `docs/media/tallynest-preview.gif`.

### 4. Record Genuine Browser Workflows

```bash
node dev/record-workflows.js
```

This script:

1. Generates a unique disposable database name (`tallynest_fresh_v2_test_*`).
2. Installs the approved database schema via `installFreshCycleSchema()`.
3. Spawns the authentic `server.js` on port `5500` and `vite` on port `5173`.
4. Registers a generated test account (`Alex Vance`) and seeds sample records.
5. Launches Playwright Chromium with `recordVideo` to record genuine user interactions for each workflow:
   - Personal Transaction Management (`transaction-workflow.gif`)
   - Monthly Category Budgets (`budgets-workflow.gif`)
   - Recurring Transaction Schedules (`recurring-workflow.gif`)
   - Collaborative Group & Cycle Lifecycle (`groups-cycle-workflow.gif`)
6. Waits for the initial application control, trims the initial 0.9 seconds of navigation, and encodes WebM videos into palette-optimized infinite-loop GIFs at 8 FPS, 1000px width.
7. Shuts down child processes, verifies database drop, and cleans up temporary video files.

---

## Privacy & Safety Standards

- **No Credentials Exposed**: All test identities, emails, and passwords are generated on the fly.
- **No Production Mutation**: Only local disposable MongoDB instances are used.
- **Deterministic Arithmetic**: The application stores integer minor units. Images illustrate UI behavior; authoritative financial assertions belong to the integration/browser suites, not image inspection.
- **Authentic UI**: Recordings capture actual user interactions with real hover states, top-layer modal dialogs, and database roundtrips.

## Validation and recording scope

All six GIFs were fully decoded and sampled across their timelines on 2026-10-22. They loop indefinitely, contain no blank or corrupt frames, and the workflow recordings start on application screens with no prolonged loading hold. The preview is a montage of actual application screenshots; the header keeps its branding visible through the entire loop. Palette encoding and layer optimization keep each asset below 5 MiB.

The group recording uses one generated owner to demonstrate expense creation and a zero-balance freeze/close. It does not demonstrate a multi-member settlement transfer or recipient acknowledgment. Multi-user behavior is exercised separately by `npm run verify:browser`. Screenshots may originate from disposable staged fixtures as well as the normal application; they are not evidence of hosted production readiness. No hosted database was used for this media regeneration.

The three scripts resolve repository paths relative to their own location. Keep ports 5500 and 5173 available for the workflow recorder; it starts its own API and frontend. It creates and drops only its generated loopback database. On errors it stops owned child services and attempts cleanup; investigate a reported cleanup failure rather than deleting unrelated databases.
