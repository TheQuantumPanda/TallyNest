# TallyNest — Monthly budget management frontend

The authenticated `/app/budgets` route now manages independent monthly category
budgets through the existing backend. Desktop and mobile navigation include
Budgets. The dark/mint product identity, transaction ledger, dashboard and auth
screens are preserved; no recurring budgets, copying, rollover, notifications,
bank integrations or backend/schema changes are introduced.

## Screens and component architecture

```text
frontend/src/
├── pages/BudgetsPage.jsx
├── components/budgets/
│   ├── BudgetOverview.jsx
│   ├── BudgetForm.jsx
│   └── BudgetOverlay.jsx
├── hooks/useBudgets.js
├── services/budgets.js
├── utils/budgets.js
├── styles/budgets.css
└── test/
    ├── Budgets.test.jsx
    ├── budgetService.test.js
    ├── budgetUtils.test.js
    └── fixtures/budgets.js
```

- `BudgetsPage`: month selection, overview/error/recovery states and dialog orchestration.
- `BudgetOverview`: server totals, category cards, textual statuses, progress,
  unbudgeted expenses, empty/loading states, saved-limit recovery and ledger link.
- `BudgetForm`: create/edit validation, known-slot state, saving, conflicts,
  explicit reload/review and unsaved-draft guards.
- `BudgetOverlay`: fetches the latest edit record, allows retry, handles deletion,
  and retains the original focus target across loading/form transitions.
- `useBudgets`: abort/generation guards, month changes, summary refresh, optional
  saved-limit recovery, and window-focus refresh.
- `budgetService`: existing Axios client, Zod response validation and API calls.
- `utils/budgets`: category projection, canonical month helpers, error messages,
  exact form conversion and utilization formatting.

The route is lazy loaded. Existing Field, Button, Notice, PageTransition and native
Dialog components are reused. Dialog gains an optional explicit return-focus
node; its default behavior is unchanged for existing callers. Sidebar, AppLayout
breadcrumb, App routes and stylesheet imports are the other frontend integrations.
No dependencies were added. All shared category/money sources remain unchanged.

## API integration

The client inspects and validates actual envelopes:

| Operation | Endpoint / response |
| --- | --- |
| Overview | GET `/api/budgets/summary?month=YYYY-MM&currency=INR` → `data.summary` |
| Current edit record | GET `/api/budgets/:id` → `data.budget`, ETag |
| Create | POST `/api/budgets` → `data.budget`, HTTP 201 |
| Update | PATCH `/api/budgets/:id`, exact If-Match → `data.budget` |
| Delete | DELETE `/api/budgets/:id` → `{ status: "ok", message: "Budget deleted" }` |
| Summary recovery | GET `/api/budgets?month=YYYY-MM&currency=INR` → `data.budgets` |

No backend contracts were modified and no compatibility defect was found.
Axios still sends credentials, injects `X-CSRF-Protection: 1` on mutations and
invalidates the session on protected 401 responses. The browser sends Origin;
no credentials/tokens are logged or placed in browser storage.

Zod validates currencies, expense categories, months, safe integer values, public
record fields, statuses, and versions. BigInt reconciliation checks validate the
server summary's partitions, remaining/overspent values, ratio/status consistency,
counts, unique categories and UTC range. These checks do not produce alternative
UI totals: all displayed financial data comes from the server response. A summary
for a different month or an incompatible ETag is refused.

Updates load the latest record, preserve its documented `"tn-ID-vVERSION"` tag,
and send it in If-Match. 428, 412 and concurrency 409 preserve the draft and disable
saving until an explicit reload/review. Reloading a dirty draft requires discard
confirmation. Duplicate-slot 409 `BUDGET_EXISTS` is handled separately: category
error plus an editable draft, allowing the user to choose a different month/slot.
No automatic retry can overwrite a changed budget.

Deletion identifies category, month and saved limit, requires confirmation, and
explains that expenses remain. Success refreshes the summary. A 404 reports the
missing record and refreshes without claiming deletion succeeded; network errors
retain the dialog for retry. Delete never calls transaction mutation endpoints.

## Money, months and financial semantics

Form amounts are decimal strings converted by the existing `positiveMinor` /
`majorToMinor` BigInt utilities. `100.50` becomes 10050 paise exactly. Zero,
negative, malformed/exponent, overprecision and unsafe inputs are rejected without
rounding. Prefilling uses existing `minorToMajor`; display uses existing `formatINR`.
Maximum-safe monetary values wrap at comma groups without splitting the decimal
part into isolated digits. No competing formatter or money representation exists.

Expense options come from shared category definitions. Configured categories in
the selected month are visibly marked and disabled for new-slot selection; the
current edit record remains selectable. Client checks are advisory: changing a
form's month or a concurrent create is resolved authoritatively by the unique
backend index and documented duplicate error.

Month selection defaults to the current **UTC** month and uses `YYYY-MM` keys.
Previous/next buttons and a native month/year input reach historical and future
records; invalid keys trigger a field error and no query. Years 0001–9999 are
supported. Page remount/reload starts at the current UTC month; selection is not
stored in browser storage or URL parameters. A form's month may differ from the
viewed month; saving refreshes the viewed month, and the record appears in its
specified month. There is no auto-renewal or copying.

Progress geometry is capped at 100%, while labels and aria-valuetext show the true
server utilization, including 150.00% or higher. Basis points are formatted with
BigInt; only visualization ratios use fractional percentages. Statuses are
textual as well as colored: Unused, Within budget, At limit, Over budget. Exact
status comes from server money comparisons, not rounded display percentages.

Configured limits, spending under budgets and remaining allowance appear as
separate summaries. Total expenses and per-category overspending are visible.
Remaining allowance is explicitly not a bank balance. A category surplus does
not cancel another category's overspending; unbudgeted spending never consumes
an unrelated allowance. The unbudgeted section shows real category expenses and
an action prefilled for that category.

The API's `best_effort` consistency is disclosed. Switching months aborts older
requests and checks a generation token; stale completions cannot overwrite a
new selection. Mutation success, focus and manual reload fetch current server
data. There is no real-time push or point-in-time snapshot guarantee.

## Loading, errors, recovery and accessibility

Empty months show legitimate server zeros, useful guidance and an Add Budget
action. Skeletons, loading/disabled saves, success notices, retry controls and safe
error messages cover request lifecycles. Failed or invalid summary responses never
produce fabricated spending/progress figures.

For a 422 unsafe/invalid summary, **Review saved limits** fetches the separately
validated CRUD listing. Users can edit/delete saved limits even when aggregate
analytics are unavailable. This view explicitly says spending is unavailable and
shows only saved allowances. The transaction ledger link supports reviewing
expenses. Corrupt individual records that fail response validation still require
trusted backend/database repair; they are never coerced into valid UI money.

Native modal dialogs provide background inertness, keyboard navigation, Escape
handling, focus restoration and scroll containment. Dirty forms warn on closing,
route navigation and browser unload; pending saves cannot be accidentally closed.
Fields have labels, hints, aria-invalid and associated errors; validation focuses
the first invalid input. Progress has a textual accessible percentage. Buttons
and controls remain touch friendly, focus visible, and page motion respects the
existing reduced-motion preference. The phone header action stacks vertically;
no other application page was redesigned.

## Executed automated verification — 2026-10-13

| Check | Result |
| --- | --- |
| Frontend tests | 122 passed across 12 files: 93 preserved + 29 new |
| Backend unit/HTTP tests | 210 passed, zero failures/skips |
| Real MongoDB integration | 56 passed, zero failures/skips |
| Frontend/backend ESLint | Passed, zero warnings |
| Configured frontend Prettier | Passed; no backend Prettier check configured |
| Production frontend build | Passed, no chunk-size warning |
| Production dependency audits | 0 vulnerabilities in both packages |
| `git diff --check` | Passed |

New tests cover empty/loading/error states, expense-only categories, all input
amount boundaries, exact conversion/prefilling, duplicate slots and saves, real
summary semantics, status/progress over 100%, unbudgeted actions, month/year
selection, stale responses/cancellation, editing/version headers, 409/412/428
reload/review, confirmed/missing/failed deletion, unsaved navigation/focus,
responsive navigation/session loss, response reconciliation and summary repair.
Existing frontend and backend behavior tests remain intact.

Executed commands:

```bash
npm test --prefix frontend
npm test --prefix backend
docker compose up -d --wait mongodb
npm run test:mongo --prefix backend
npm run lint --prefix frontend
npm run lint --prefix backend
npm run format:check --prefix frontend
npm run build --prefix frontend
npm audit --omit=dev --prefix frontend
npm audit --omit=dev --prefix backend
git diff --check
```

Final build: lazy BudgetsPage chunk 23.85kB minified / 7.52kB gzip; main entry
248.72kB / 84.66kB gzip. Recharts remains deferred and is not needed by budgets.
There is no warning-threshold change or new runtime dependency.

The final integration databases were `tallynest_budget_summary_test_1791889342994_eba776079cbd`,
`tallynest_budget_test_1791889342992_077facae8fab`,
`tallynest_dashboard_test_1791889342777_fd384fe4` and
`tallynest_crud_test_1791889342951_719eb71b4b41`.
All were dropped and confirmed absent.

## Actual Chromium integration and screenshots

The Playwright skill drove installed Chromium against production frontend assets,
the actual Express API and Docker MongoDB. Temporary servers used generated
in-memory signing secrets and disposable accounts, without loading `.env` or
reading/modifying development financial data. Verified:

- Registration, sign-out and subsequent login; empty budget month and unused limits.
- Budget creation through the form: Food & Dining ₹100.50, Shopping ₹500,
  Utilities ₹100. Expenses added through the existing transaction forms: ₹150.75,
  ₹125, ₹100, plus ₹50 Travel. Income did not offset spending.
- Actual totals: expenses ₹425.75, budgeted ₹375.75, unbudgeted ₹50,
  remaining allowance ₹324.75 and category overspending ₹50.25.
- Within-budget, at-limit and 150% over-budget cards and separate travel spending.
- Mobile navigation, keyboard cycling without background controls receiving focus,
  narrow modal/forms, actual If-Match and CSRF request headers, and refresh persistence.
- Edit to ₹200.75; concurrent API update while editing produced real 412,
  retained the ₹250.50 draft, and required explicit discard/reload/review before retry.
- Delete Utilities left total expenses unchanged and moved its ₹100 to unbudgeted.
  Category-prefilled unbudgeted actions created new limits; deleting a Travel limit
  left its expense intact. Screenshot fixtures were restored afterward.
- Historical/year selection, future-month budgets and a maximum-safe limit
  ₹9,00,71,99,25,47,409.91 with all digits readable at 320px.
- Desktop 1440×1000, tablet 1024×900, mobile 390×844, narrow 320×800:
  settled page scroll width equaled viewport width at all four sizes. Reduced
  motion was exercised. Immediate post-resize measurements were corrected to wait
  for layout frames, and the phone header action was stacked for comfortable use.
- Real protected-API 401 after cookie removal redirected to login with session-ended
  guidance. This simulated loss of the authentication cookie, not a wait for JWT expiry.
- Real aggregate overflow from MAX_SAFE_INTEGER plus one paise: saved limits were
  reviewable without invented spending; editing the huge limit restored the summary.

Browser databases (all dropped and removal confirmed):
`tallynest_budget_browser_1791888369799_26b4af9d61`,
`tallynest_budget_browser_1791889080658_706977b925`,
`tallynest_budget_browser_1791889413268_bcea36c2dc`, and
`tallynest_budget_browser_1791889702823_0179030563`.
Browsers and temporary servers were closed. Docker MongoDB remains running.
Expected 401/412/422 console responses occurred during intentional security/error
checks; there were no observed application runtime exceptions. Transient scripting
assertions were corrected before the completed checks above.

Ignored review screenshots contain disposable data:

- [Desktop](../output/playwright/tallynest-budgets-desktop.png)
- [Tablet](../output/playwright/tallynest-budgets-tablet.png)
- [Mobile](../output/playwright/tallynest-budgets-mobile.png)
- [320px](../output/playwright/tallynest-budgets-narrow.png)
- [Empty](../output/playwright/tallynest-budgets-empty.png)
- [Narrow dialog](../output/playwright/tallynest-budgets-dialog-narrow.png)
- [Maximum-safe limit](../output/playwright/tallynest-budgets-large-narrow.png)
- [Summary recovery](../output/playwright/tallynest-budgets-recovery.png)

## Running and limitations

Use existing commands: `docker compose up -d --wait mongodb`, then `npm run dev
--prefix backend` and `npm run dev --prefix frontend` in separate terminals.
Open `http://localhost:5173/app/budgets`. Preserve existing `.env` settings and use
localhost consistently so Origin/cookie rules continue to match. No new configuration.

Limits: INR, UTC independent monthly records, backend best-effort consistency and
safe-number limits. Month choice resets on route remount; native month-picker UI
varies by browser. Data refreshes on navigation/focus/mutation/manual reload rather
than push. Automated coverage includes all requested conflict codes; live browser
conflict verification used 412. There is no recurring/rollover/copy functionality.
All changes remain uncommitted for review.
