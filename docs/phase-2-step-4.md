# TallyNest — Transaction management frontend

Phase 2, Step 4 adds a responsive personal ledger at `/app/transactions`, available
through desktop and mobile navigation. It connects to the existing authenticated
Express API. No analytics, balances, budgets, recurring transactions, or group
features are implemented, and authentication screens retain their existing design.

## Functionality and components

- `TransactionsPage` composes the page, mutation notifications, filters, and overlays.
- `TransactionList` supplies a semantic desktop table and purpose-built mobile
  cards, with explicit income/expense text and arrows as well as color. Title
  buttons open details; named edit/delete controls are always available.
- `TransactionForm` handles add/edit, type-dependent categories, exact amount
  input, validation, pending requests, conflict recovery, and unsaved-change guards.
- `TransactionFilters` provides type, category, dates, literal title search, four
  sort modes, active filter chips, and Reset Filters.
- `TransactionDetails` shows the latest fetched record and notes;
  `DeleteTransaction` requires confirmation and handles missing records safely.
- `TransactionEmptyState` and `TransactionSkeleton` supply helpful empty/loading
  states without invented financial values.
- Shared `Dialog` uses the native modal dialog API for focus containment, Escape,
  an inert background, initial input focus, scroll locking, and focus restoration.
  Mobile forms use a scrollable sheet with touch-sized controls.
- `useTransactions` owns request cancellation, generation guards, loading/error
  states, cursor pages, and de-duplication. `useDebouncedValue` delays search 300ms.
- `transactionService` owns Axios calls and validated response transformation;
  presentation components never assume raw controller envelope shapes.

The app uses React Router's existing data router capabilities to block navigation
away from unsaved forms. Its URLs and authentication flow remain the same. The
transaction page is lazy loaded. Existing reduced-motion preferences apply to
page transitions and skeleton animation.

## Local development

From the repository root, use separate terminals:

```bash
docker compose up -d --wait mongodb
npm run dev --prefix backend
```

```bash
npm run dev --prefix frontend
```

Use Node.js 24 LTS and install each package with `npm ci` if dependencies are absent.
Keep the existing backend `.env` settings; follow README setup instructions when
configuring a new checkout. Open `http://localhost:5173`, sign in, then choose
Transactions. The default API URL remains `http://localhost:5000/api`.
`VITE_API_URL` is a public API URL, never a server secret. Vite explicitly allows
only frontend and shared source directories for this development integration.

## API integration and financial integrity

The [Step 3 API contract](phase-2-step-3.md) remains unchanged. The service reads
`data.transactions` and top-level `pagination`, and single-record responses from
`data.transaction`. Zod verifies safe integer amounts, currency, categories,
versions, timestamps, and pagination before displaying them, and strips unexpected
server fields. It never logs request bodies, credentials, JWTs, or cookies.

The existing Axios client supplies `withCredentials: true`, the CSRF header for
state changes, and centralized session invalidation on protected 401 responses.
Origins remain browser-controlled and restricted by the existing backend checks.
No tokens or drafts are written to localStorage or sessionStorage.

Central category definitions and pure exact money utilities now live in `shared/`.
The original backend modules re-export the same API, so backend imports and
financial behavior remain compatible. There is no competing category list.

Decimal input is text: `100`, `100.5`, `100.50`, and `0.01` are accepted. Conversion
uses BigInt arithmetic before a checked safe-integer Number conversion. Zero,
negative input, overprecision, exponents, separators, malformed input, and unsafe
values are rejected without rounding. API amounts remain integer paise. Display
uses exact decimal strings with Indian grouping: 125050 → ₹1,250.50. Large amounts
retain precision up to `Number.MAX_SAFE_INTEGER` and may wrap on small screens.

New entries select a calendar date stored at UTC midnight. Editing an unchanged
calendar date preserves the complete existing UTC timestamp, including time and
milliseconds. Choosing another date explicitly sets UTC midnight for that date.
Ledger dates display in UTC. Filter start and end days are inclusive in the UI;
the end day is translated into the API's exclusive next-day UTC boundary. Invalid
or reversed date ranges stop fetching and show field messages.

## Pagination, filtering, and concurrency

The initial page uses the API default of 20. Load More sends the opaque next cursor,
preserves server order, and appends unique IDs. A synchronous request guard prevents
duplicate page requests. Filters and sorting reset pagination. Search changes
immediately cancel old requests, suspend paging, then fetch once after debouncing.
AbortController and generation checks prevent stale initial or page responses from
replacing a newer view. No filtering is simulated over only one loaded page.

Rejected/expired cursors keep already loaded records visible and offer Reload List,
which starts again without a cursor. Successful mutations restart the current
server query; a deleted record is not retained as visible data during that refresh.
A deletion 404 shows an unavailable-record message and refreshes rather than
claiming that the user's deletion succeeded.

Editing first fetches the latest transaction. The form retains its server ETag, or
constructs the API's documented resource/version tag when only version is available.
PATCH sends `If-Match`. 409, 412, and 428 keep the draft visible, disable saving
with that stale state, and offer Reload Latest Transaction. Reloading or closing
a changed draft requires explicit discard confirmation. Reload resets the form
even if the version is unchanged (important for 428 recovery). Route navigation
is blocked until the user chooses to stay or discard; browser unload uses its
standard unsaved-change prompt. No automatic write retry overwrites newer data.

## Automated results — 2026-10-13

| Check | Result |
| --- | --- |
| Frontend Vitest | 82 passed in 7 files: 36 existing and 46 new |
| Backend Node tests | 165 passed, zero failures/skips |
| Real MongoDB integration | 30 passed, zero failures/skips |
| Frontend/backend ESLint | Both passed, zero warnings |
| Shared module ESLint | Passed |
| Frontend Prettier | Passed |
| Shared module Prettier | Passed using the frontend configuration |
| Production frontend build | Passed; transaction route is a separate chunk |
| Frontend/backend production audits | Both reported 0 vulnerabilities |
| `git diff --check` | Passed |

Tests cover loading/empty/error states, income/expense creation, precise conversion,
category relationships, edit/version headers, 409/412/428 recovery, confirmations,
filtering/sorting, range validation, cursors, expired cursors, stale responses,
session loss, mobile navigation, focus, and unsaved navigation. The existing stale
session-response test now waits for its pending request before logout to avoid a
timing race; its behavioral assertion is preserved.

The MongoDB suite used `tallynest_crud_test_1791877105838_a336b0794331` and confirmed
its deletion. No production/development data was modified.

## Actual Chromium integration and screenshots

The Playwright CLI drove installed Chromium against Vite and an actual Express
server on port 5100, using the unique disposable database
`tallynest_browser_1791876410097_57d8d907`. The server used a generated in-memory
signing secret and a 60-second cookie/token lifetime for expiry verification.
No normal `.env` or development database was used.

Verified through the UI:

- Registration, sign-out, and subsequent login using a disposable account.
- Income and expense creation, then refresh and persisted retrieval.
- Type filtering, literal title search, reset, and amount sorting.
- Editing with an actual If-Match request and exact persisted amount.
- A competing API update followed by a real UI 412 response: the draft survived,
  reload required confirmation, and a refreshed-version save succeeded.
- Confirmed deletion and disappearance of the deleted entry.
- Expired-session request redirected to login with the session-ended message.
- Desktop at 1440×1000 and mobile ledger at 390×844, including mobile navigation
  and an assertion that page width did not overflow horizontally.
- Form initial focus, keyboard focus remaining inside the native dialog, and
  unsaved-close confirmation. Mobile form screenshot uses a 390×1000 viewport.

Screenshots contain only disposable verification records:

- [Desktop ledger](../output/playwright/tallynest-transactions-desktop.png)
- [Mobile ledger](../output/playwright/tallynest-transactions-mobile.png)
- [Mobile form](../output/playwright/tallynest-transaction-form-mobile.png)

The screenshots were visually inspected. These review artifacts are ignored by Git.
The disposable database was dropped and its removal confirmed; browser and temporary
verification servers were stopped. Docker MongoDB remains available.

## Files and remaining limits

Added `shared/transaction.constants.js`, `shared/money.js`, the transaction page,
transaction components, Dialog, hooks, service, validation/formatting utilities,
transaction CSS, three frontend test files, and this documentation. Modified app
routes, shell/sidebar navigation, the welcome-page availability copy, main router,
Vite source allowance, style imports, README, and the original backend constant/money
modules (compatibility re-exports only).

No backend response/authentication compatibility defect was found. No dependencies
were added. The backend schema and API contracts did not change.

Intentional limits: forward Load More only; filtering restarts rather than preserves
scroll position; unsaved drafts are memory-only and cannot survive a lost session;
forms edit calendar dates rather than time-of-day; title search inherits the backend
scan/time-budget limits; data changes between pages can cause the backend's documented
repeats/omissions (the UI deduplicates repeated IDs). Browser checks did not exercise
large multi-page datasets; automated frontend and real backend tests cover cursors.
The build reports a main JavaScript chunk above 500kB (about 558kB minified, 178kB
gzipped); route splitting is implemented, but broader bundle optimization is future
work. All changes remain uncommitted for review.
