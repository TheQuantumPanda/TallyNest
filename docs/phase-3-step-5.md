# Phase 3, Step 5 — Recurring management frontend

Implemented and verified on 2026-10-13. Open `/app/recurring` from the shared
sidebar/mobile navigation. The page manages scheduled personal transaction entries;
it does not move money, execute subscription payments or forecast financial totals.
Backend recurrence, persistence, authentication and financial contracts are unchanged.

## Functionality

Cards display title, income/expense text and icon, shared category label, exact INR
amount, frequency, authoritative next UTC date, optional inclusive end, status and
actions. Active/paused and exhaustion are distinct: an exhausted active schedule
shows **Active · Exhausted**, not paused. Active past next dates are labeled overdue;
reserved work has a textual processing notice. No future ledger entries are invented.

Status filtering is server-side (`active`/`paused`, or omit for all). Pages use
`limit=20`, documented `after` and `nextAfter`, retaining server order. Load More
has an immediate submission guard, deduplicates IDs, and resets on filter/mutation
changes. AbortController plus generation checks reject stale initial/appended responses.
A load-more failure preserves existing rows and offers a full reload. Window focus
refreshes the list. Empty, loading, retry, sanitized API error and expired-session
states use existing authentication/UI conventions.

Add/edit forms cover income/expense, title, decimal amount text, compatible category,
daily/weekly/monthly/yearly frequency, start UTC date/time, optional end and notes.
New schedules start active; pause/resume are explicit confirmed actions. Currency is
INR. Edit fetches the current record before opening its form. Optional notes/end are
cleared with null on PATCH; original millisecond precision is retained on prefilling.

The datetime-local editor is explicitly labeled UTC. Its wall-clock string is
canonicalized by appending UTC with validated seconds/milliseconds, never parsed
through browser-local Date construction. Invalid calendar dates, year zero, offsets,
unsupported precision and end-before-start are rejected. Backend canonical dates
remain `YYYY-MM-DDTHH:mm:ss.sssZ`. Native browsers may visually normalize zero
seconds/milliseconds; conversion restores them exactly. Creation defaults to the
current UTC minute, which may already be due when saved.

Amounts reuse shared BigInt decimal-string conversion and the existing INR formatter;
no parseFloat, floating multiplication or silent rounding. Positive paise, safe
integer boundaries, text lengths and category/type compatibility match the backend.
Type changes update available categories. Monthly 29th/30th/31st and yearly leap-day
behavior is explained without calculating a speculative forecast.

## Concurrency, lifecycle and processing

Single-record responses require a valid server ETag matching public ID/version.
PATCH and pause/resume send that exact quoted ETag via If-Match. Lifecycle operations
fetch the latest record before confirmation; an intervening race still fails safely.
428/412/409 and RECURRING_BUSY produce clear messages. Edit conflicts retain the draft,
disable further saves, and offer explicit reload/review. Reload or close warns before
replacing unsaved changes; a failed reload retains the old draft. Router navigation
and browser unload are guarded. There are no silent retries or merges.

Paused schedules retain their cursor. Resuming may catch up eligible dates missed
during pause; periods are not promised to be skipped. Edits affect uncompleted dates
and never rewrite historical records. Delete requires confirmation identifying the
schedule; it preserves generated history and does not reverse real-world payments.
404 refreshes the list without claiming success; busy/network errors remain retryable.

**Check due entries** performs exactly one `POST /api/recurring/process` with numeric
`limit: 20`. It prevents simultaneous duplicate clicks and displays generated,
recovered, advanced, errors, conflicts and whether more work remains. HasMoreDue does
not trigger a browser loop. A failed request refreshes the list because the write
outcome may be unknown; retry is deliberate and backend idempotency remains authoritative.
429 offers a wait/retry message. Busy schedule edits can be retried after background
processing finishes, or after leaving the draft with explicit discard confirmation
and running the page's manual check.

Sleeping hosts cannot execute on time; startup/periodic catch-up remains backend-owned.
Schedules themselves never enter dashboard/budget totals. The existing transaction API
has no recurring-schedule filter, so this page links to the general ledger and clearly
states that schedule-specific history is unavailable. The ledger service now retains
validated optional `recurrence` provenance instead of stripping it from API results.
No limited page is presented as complete per-schedule history.

## API integration

The service inspects/validates actual `{ status: 'ok', data: { schedule } }`,
`data.schedules` plus pagination, and `data.processing` envelopes with Zod. Schedule
financial fields derive from the existing transaction response schema and shared
categories; recurrence/date/status invariants are validated separately. Requests reuse
the central Axios client: credentials included, X-CSRF-Protection automatically set
for mutations, existing 401 session invalidation, no token browser storage. Errors
never render raw server/driver details.

No backend integration defect was found, and no backend files/contracts changed.
See [Step 4](phase-3-step-4.md) for durable reservations, tombstone receipts, indexes,
calendar and concurrency semantics.

## Architecture and changed file tree

```text
README.md                                      (updated)
docs/phase-3-step-5.md                         (new)
frontend/src/
├── App.jsx                                   (lazy route)
├── components/
│   ├── Sidebar.jsx                           (shared navigation)
│   └── recurring/
│       ├── RecurringList.jsx                 (cards, empty and skeleton)
│       ├── RecurringForm.jsx                 (exact input, draft/conflicts)
│       ├── RecurringOverlay.jsx              (fresh reads and confirmations)
│       └── DueProcessing.jsx                 (one bounded manual check)
├── hooks/useRecurring.js                     (fetch/pagination cancellation)
├── layouts/AppLayout.jsx                     (breadcrumb)
├── pages/RecurringPage.jsx                   (page composition)
├── services/
│   ├── recurring.js                          (validated API integration)
│   └── transactions.js                       (retain optional provenance)
├── utils/recurring.js                        (UTC/form validation and errors)
├── styles/
│   ├── index.css                             (style import)
│   └── recurring.css                         (scoped responsive styles)
└── test/
    ├── Recurring.test.jsx
    ├── recurringService.test.js
    ├── recurringUtils.test.js
    └── fixtures/recurring.js
```

No dependencies or environment settings were added. The new route is lazy-loaded;
existing dashboard, budget, transaction and authentication layouts were not redesigned.
Dialogs reuse native dialog focus containment, Escape handling, focus restoration,
visible labels/errors and existing reduced-motion infrastructure. Action touch targets
are at least 44px tall. Cards wrap long amounts and category/title text.

## Verification results

| Executed command | Result |
| --- | --- |
| `npm test --prefix frontend` | 165 passing tests / 15 files, including 43 new tests |
| `npm test --prefix backend` | 237 passed, zero failed/skipped |
| `npm run test:mongo --prefix backend` | 75 passed, zero failed/skipped |
| `npm run lint --prefix frontend` | Passed, zero warnings |
| `npm run lint --prefix backend` | Passed, zero warnings |
| `npm run format:check --prefix frontend` | Passed; no configured backend Prettier command |
| `npm run build --prefix frontend` | Passed |
| Both production `npm audit --omit=dev` commands | Zero vulnerabilities |
| `git diff --check` | Passed |

New tests cover forms, all frequencies/types, exact maximum-safe money, UTC invalid
calendar/range/precision checks, statuses, ETags, 428/412/409/busy recovery, failed
reload preservation, unsaved close/Escape/navigation/unload guards, creation double
submission, lifecycle confirmations, deletion errors, filtering, pagination and
request cancellation, processing/429 handling, provenance retention, mobile navigation
and session protection. Existing tests remain intact.

Production output keeps the recurring code in its own route chunk (approximately
25kB minified / 8.4kB gzip). No warning threshold was raised and no dependencies were
installed; existing dependencies were used.

### Actual Chromium + Express + MongoDB

Ran real Chromium against Vite port 5174 and the actual Express server on port 5001,
configured through process-only variables and a new random signing secret. Database:
`tallynest_recurring_ui_test_1791896618746_29c10a34f561`. No `.env` was overwritten.
Only disposable account/data were used. Executed:

- Registered, logged out and logged back in; session restoration retained the route.
- Created daily expense (10050 paise) and monthly income schedules through UI.
- Refreshed and retrieved persisted schedules, including UTC anchors and categories.
- First manual check generated/advanced one entry with zero errors; repeated check
  generated/advanced zero, confirming no duplicate visible occurrence.
- Paused/resumed monthly schedule using fresh ETags, then filtered paused status.
- Edited to Number.MAX_SAFE_INTEGER paise, verifying exact display and persistence.
- Simulated a real concurrent backend update while editing; UI received 412,
  retained the 25000.02 draft, warned on reload, displayed the new stored notes,
  and saved only after explicit review with the new ETag.
- Deleted daily schedule; its generated expense remained in the ledger and dashboard.
  Dashboard showed ₹100.50 expenses / −₹100.50 net flow, excluding the future template.
- Negative live requests returned 403 without CSRF, 428 without If-Match and 412
  with stale If-Match. Captured UI mutation requests included CSRF and quoted versions.
  Cookie metadata was HTTP-only, SameSite=Lax, Secure=false for local HTTP; values
  were not captured in this report.
- At 1440/1024/390/320 widths, document scrollWidth equaled viewport width. At 320,
  dialog content width equaled its 318px inner width; 22 Tab presses remained
  contained, Escape dismissed and focus returned to Add schedule. Mobile navigation
  opened and selected Recurring. Reduced-motion emulation produced no page transform.
- No JavaScript runtime page errors were observed. Expected failed security requests
  produced browser HTTP error entries; these were intentional checks.
- Independent MongoDB inspection confirmed one remaining monthly template (2500002
  paise) and one historical daily expense (10050 paise) with provenance after deletion.

Both temporary servers and Chromium were stopped. Browser database was dropped and
its absence confirmed; all five MongoDB integration databases were also cleaned up. A separate final
database-name check confirmed all six disposable databases were absent.

Screenshots (local ignored artifacts, retained for review):

- `output/playwright/recurring/desktop-1440.png`
- `output/playwright/recurring/tablet-1024.png`
- `output/playwright/recurring/mobile-390.png`
- `output/playwright/recurring/mobile-320.png`
- `output/playwright/recurring/form-320.png`
- `output/playwright/recurring/reduced-motion-320.png`

Desktop/mobile overview screenshots were captured during the maximum-safe amount
boundary check before deletion; these are real persisted disposable test data.

## Local use and limitations

Use the normal README commands: `docker compose up -d --wait mongodb`,
`npm run dev --prefix backend`, and `npm run dev --prefix frontend`. Open
`http://localhost:5173/app/recurring`; keep CLIENT_ORIGIN/API host configuration aligned.
No new environment variables are needed. Mutations refresh the schedule list; the
ledger/dashboard fetch authoritative data when revisited or refreshed.

Schedule-specific generated history filtering remains a future API enhancement.
Listing is a current-data keyset traversal rather than a snapshot. There is no
real-time subscription/polling of schedule progress; reload/window focus retrieves
current state. Extremely large safe amounts can wrap on narrow screens to preserve
all digits. Busy and generic 409/428 frontend recovery are automated/mock-tested;
a real stale 412 was exercised in Chromium. Live process 429 was not triggered;
its UI behavior and backend rate limiter are covered by automated tests. No dedicated
screen-reader audit was performed. Recurrence/sleep/retained receipt limitations from
Step 4 remain unchanged. Changes are uncommitted, with no new paid service or scheduler.
