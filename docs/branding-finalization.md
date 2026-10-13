# TallyNest branding finalization

Verified on 2026-10-13. Official product name: **TallyNest**.
Tagline: **Your money. In perspective.**

## Changes

- `frontend/src/components/Brand.jsx`: new wordmark, accessible home-link label,
  shared SVG asset, and tagline on the noncompact variant.
- `frontend/public/brand-mark.svg`: original mint mark combining three tally strokes
  with two nested lines. The same asset appears in the authentication illustration.
- `frontend/public/favicon.svg`: matching mark on the existing dark background,
  scaled for small favicon sizes.
- `frontend/src/layouts/AuthLayout.jsx`, `AppLayout.jsx`, and
  `frontend/src/components/auth/AuthForm.jsx`: updated visible and accessible names.
  Authentication pages show the tagline below the wordmark; the authenticated
  shell shows it in the footer, avoiding repetition within a screen.
- `frontend/src/styles/auth.css`: illustration sizing now targets the shared SVG image.
- `frontend/index.html`: TallyNest page title and description metadata.
- Both package manifests and lockfiles: private package names and descriptions updated;
  dependency versions, scripts, source filenames, and database collections unchanged.
- `backend/server.js`: branded startup log only; no authentication or API changes.
- `README.md` and `docs/phase-1-step-4.md`: current branding and explicit historical
  screenshot qualification. The preexisting `.gitignore` modification was preserved.

The mint accent and existing layouts, typography, component behavior, and spacing
remain intact. No environment-secret files or database contents were changed.

## Verification

| Check | Result |
| --- | --- |
| Frontend tests | 36 passed |
| Backend tests | 32 passed |
| Frontend and backend ESLint | Passed, zero warnings |
| Frontend Prettier check | Passed |
| Production frontend build | Passed |
| `git diff --check` | Passed |
| SVG parsing and matching path geometry | Passed |

Chromium branding checks used mocked anonymous/authenticated session responses;
no MongoDB server or new live authentication integration test was needed. Login
and sidebar branding were inspected at 1440×1000 and 390×844. The mobile drawer
wordmark fits its bounds, SVG assets load, and the page title is TallyNest. The
favicon was rendered at 16 and 32 pixels. Screenshots are Git-ignored review artifacts:

- `output/playwright/tallynest-login-desktop.png`
- `output/playwright/tallynest-login-mobile.png`
- `output/playwright/tallynest-sidebar-desktop.png`
- `output/playwright/tallynest-sidebar-mobile.png`
- `output/playwright/tallynest-favicon-sizes.png`

## Remaining legacy references

Repository searches covered maintained source, documentation, package metadata,
environment examples, and the generated production frontend. No outdated branding
remains in the frontend source, package metadata, or production frontend assets.

| Location | Classification and reason retained |
| --- | --- |
| Backend health controller, its test, and README response example | Stable API response message; preserving the existing API contract |
| Backend auth service and JWT tests | Existing issuer and audience identifiers; changing them would invalidate issued tokens |
| Backend environment example and environment test | Existing MongoDB database name; renaming it could select a different database |
| Git-ignored historical browser snapshots/screenshots | Archived verification evidence from before rebranding; not application assets |

Dependency caches, Git history, and actual private `.env` files are excluded from
display-branding searches. Historical screenshot records remain explicitly labeled;
they are not silently presented as current TallyNest UI.
