# TallyNest — Real personal financial dashboard

The authenticated `/app` route now shows a financial overview from actual personal
transaction records. It includes net cash flow, total income/expenses, a comparison,
Recharts cash-flow and category visualizations, latest selected-period entries,
and the existing Add Transaction workflow. Net cash flow is explicitly labeled as
recorded income minus expenses, never a verified account/bank balance.

## Dashboard API

`GET /api/dashboard/summary` requires the existing HTTP-only access cookie.
Browser calls use the existing Axios client with credentials. Authentication
failures retain 401/session invalidation behavior. This read-only endpoint adds no
mutation or authentication protocol. Responses set `Cache-Control: no-store`.
The endpoint permits 120 requests per authenticated user per 15 minutes in memory.

Validated query:

| Parameter | Accepted values | Default |
| --- | --- | --- |
| `period` | `this_month`, `last_month`, `last_3_months`, `this_year` | `this_month` |
| `currency` | `INR` | `INR` |

Unknown/repeated parameters, arbitrary owner identifiers, unsupported currencies,
raw MongoDB operators, manual date ranges, and unsupported periods return 400
`INVALID_QUERY`. Only the four bounded calendar periods are supported in this step.

Example:

```text
GET /api/dashboard/summary?period=this_month&currency=INR
```

Illustrative envelope (cashFlow normally contains every bucket, including zeros):

```json
{
  "status": "ok",
  "data": {
    "summary": {
      "currency": "INR",
      "reportingTimezone": "UTC",
      "period": {
        "id": "this_month",
        "from": "2026-10-01T00:00:00.000Z",
        "to": "2026-11-01T00:00:00.000Z",
        "grouping": "day"
      },
      "totals": {
        "incomeMinor": 100000,
        "expenseMinor": 35000,
        "netMinor": 65000,
        "transactionCount": 3
      },
      "cashFlow": [
        {
          "date": "2026-10-13T00:00:00.000Z",
          "incomeMinor": 100000,
          "expenseMinor": 35000,
          "transactionCount": 3
        }
      ],
      "spending": [
        { "category": "food_dining", "amountMinor": 25000, "shareBasisPoints": 7143 },
        { "category": "shopping", "amountMinor": 10000, "shareBasisPoints": 2857 }
      ],
      "recentTransactions": []
    }
  }
}
```

`recentTransactions` contains up to five public transactions using the existing
transaction response shape (including version), sorted by date descending then ID
descending, restricted to the selected period. Internal owner/version storage fields,
credentials, and database error details are excluded. Errors use the existing
`{ status: "error", code, message }` envelope. 422 `SUMMARY_OVERFLOW` rejects unsafe
totals; 422 `SUMMARY_DATA_INVALID` rejects invalid matching stored records;
422 `SUMMARY_INCONSISTENT` rejects unreconciled facets. Database/timeout failures
are sanitized to 500 `INTERNAL_ERROR` in all environments. 429 indicates rate limiting.

## UTC calendar rules

The server clock selects boundaries, using **UTC** consistently. Start is inclusive
and end exclusive, so adjacent calendar periods do not double-count records.

| Selector | Window | Buckets |
| --- | --- | --- |
| This month | Current month start to next month start | Daily |
| Last month | Previous month start to current month start | Daily |
| Last 3 months | Start of the month two months before current, through next month start | Weekly |
| This year | January 1 through next January 1 | Monthly |

Last 3 months means three calendar months including the current month, not a rolling
90-day interval. Weeks start Monday. Edge weeks may be partial: their bucket date
can precede the selected window, but only records inside the window are included.
Periods cover full calendar windows; future-dated records within them are included
as recorded transactions, not forecasts. Empty buckets are filled with genuine
zero values. Leap days and year boundaries use UTC calendar operations.

## Exact monetary aggregation and reconciliation

The repository begins with an owner ObjectId and half-open date `$match` using the
existing owner/date index. A single MongoDB `$facet` computes totals by currency/type,
expense-category totals, time buckets, integrity checks, and a bounded latest-five
list. Only grouped results and five recent records reach application memory.
No additional indexes, schema fields, group templates, or recurring data models
are introduced; the existing transaction collection currently contains personal
records only.

Every accepted amount is a positive safe integer in minor currency units (paise).
MongoDB converts each value to **Int64 first**, then to **Decimal128** before `$sum`.
This preserves the complete integer value and avoids direct double-to-decimal
conversion losing significant digits. See [MongoDB conversion behavior](https://www.mongodb.com/docs/manual/reference/operator/aggregation/todecimal/).

The service reads integral Decimal128 sums as BigInt, checks each returned total
against `Number.MAX_SAFE_INTEGER`, and only then converts to JSON numbers. Net is
computed with BigInt subtraction. Unsafe aggregates are rejected explicitly;
no rounded or partially accurate summary is returned. Income/expense totals remain
separate, and unsupported matching currencies fail integrity checking rather than
being silently combined or omitted. Matching raw documents with invalid numeric
precision, amount range, type/category compatibility, or currency also fail closed.
Normal writes still use existing model and service validation.

Category sums must equal expense totals. Time-bucket income/expense totals and
counts must equal their summary counterparts. All facets process the same matched
input stream, avoiding separate independently changing sum queries. This does not
claim snapshot isolation against all concurrent database writes.

Category percentages use integer basis points (10000 = 100%). Floors plus the
largest fractional remainders allocate a deterministic total of exactly 10000
basis points; category ID breaks ties. Labels communicate approximate shares.
A positive category rounded to zero basis points displays `<0.01%` and retains its
exact monetary total in the legend. No fractional paise are allocated as money.

Comparison percentages use BigInt division rounded half-up to two decimal places.
Chart geometry alone uses normalized integer ratios on a 0–10000 scale. Tooltips
and the accessible data table retain exact original minor amounts. Axis labels are
approximate, abbreviated (k/L/cr/B/T where useful), and keep cent precision for
small values. Chart animation is disabled to avoid partial geometry during resizing;
page transitions honor reduced-motion preferences.

## Frontend behavior and architecture

- `DashboardPage`: period controls, real totals, comparison, add form, and error/loading states.
- `DashboardPanels`: SummaryCard, cash-flow panel, category legend, recent entries,
  compact empty-period guidance, skeletons, and chart error boundaries.
- `DashboardCharts`: lazy Recharts module for area and donut charts; never loaded
  merely to draw fictional charts for an empty period.
- `dashboardService`: parses the actual `data.summary` envelope and checks monetary
  reconciliation with Zod and BigInt before display.
- `useDashboard`: aborts superseded requests and guards their generation, reloads
  on window focus, period changes, manual refresh, and successful dashboard creation.
- Shared dashboard helpers: period IDs, exact ratios and deterministic category-share allocation.

The page reuses TransactionForm, cookie/CSRF handling, existing category definitions,
and monetary formatting. Returning from the ledger remounts/fetches the overview,
so edits/deletes are reflected; adding directly reloads the selected report. No
automatic polling, global state framework, or duplicated finance form is added.

Empty periods show legitimate zero cards, a clear Add action, and a ledger link;
unneeded empty charts are omitted. A chart-specific failure leaves exact totals
and the data table available. API failures offer retry; unsafe summaries show
review guidance instead of misleading values. Session loss follows the existing
authentication flow. New entries default to today's UTC date, so an entry may not
appear in a selected historical period until the appropriate period is chosen.

## Bundle investigation and results

A baseline production build was executed before adding Recharts. React/runtime and
Zod were in the large entry bundle. Two coherent vendor groups now separate those
shared dependencies, the dashboard route is lazy, and Recharts is deferred to its
chart module. The warning threshold was not changed. Production Chromium verification
used these split assets, including authentication, forms, and actual chart rendering.

| Asset / measure | Before | After |
| --- | --- | --- |
| Entry JavaScript, minified | 558.28kB | 247.89kB |
| Entry JavaScript, Vite gzip estimate | 177.78kB | 84.47kB |
| Initial static JS dependency graph, minified | 558.28kB | 552.89kB |
| React/runtime chunk | Included in entry | 218.76kB |
| Zod chunk | Included in entry | 85.51kB |
| Dashboard route | Absent | 14.03kB |
| Shared transaction form chunk | Included with ledger | 13.28kB |
| Deferred charts including Recharts dependencies | Absent | 374.60kB (108.02kB gzip) |

Entry-size reduction is primarily splitting/caching, not a claim that first-load
transfer halved. The initial static graph stays approximately the same size. The
new chart code costs additional bytes only when a populated dashboard renders it.
No latency benchmark or cache/deployment infrastructure was introduced. The final
build has no chunk-size warning.

## Executed verification — 2026-10-13

| Check | Result |
| --- | --- |
| Backend default tests | 178 passed: 165 existing plus 13 new |
| Frontend Vitest | 93 passed: 82 existing plus 11 new, in 9 files |
| MongoDB integration | 35 passed: existing 30 plus 5 dashboard checks |
| Frontend/backend/shared ESLint | Passed, zero warnings |
| Configured frontend/shared Prettier | Passed; backend has no Prettier check |
| Production frontend build | Passed without chunk warnings |
| Both production dependency audits | 0 vulnerabilities |
| `git diff --check` | Passed |

Frontend authentication assertions now expect the real overview heading instead of
the retired welcome screen; their original behavioral coverage remains intact.
Tests cover empty values, exact sums/net, category reconciliation, UTC/date/owner
boundaries, largest safe integers and overflow, invalid queries and authentication,
period changes/stale responses, currency/chart transformation, navigation, creation,
and partial chart errors. Existing CRUD/concurrency/session/mobile tests remain passing.

The final MongoDB test databases were
`tallynest_dashboard_test_1791880986512_1b20ffb7` and
`tallynest_crud_test_1791880986772_fe9127f70650`; both were dropped and removal confirmed.

## Actual production Chromium verification

The production frontend build was served with the actual Express createApp API
against `tallynest_dashboard_browser_1791880441782_c58af746`. The verification server
used a generated in-memory signing secret and disposable accounts, without reading
normal `.env` settings or development financial data.

Verified:

- Registration, sign-out, login, and a brand-new account with zero records.
- Add income ₹1,000 and expenses ₹200/₹100 through the existing form: income ₹1,000,
  expense ₹300, net ₹700, and reconciled category shares 66.67%/33.33%.
- All four selectors and daily/weekly/monthly charts from actual SVG geometry.
- Recent transactions and navigation to the ledger; edit ₹200 to ₹250 and return:
  expenses ₹350, net ₹650, retained after refresh.
- Desktop 1440px, tablet 1024px, mobile 390px, narrow mobile 320px: no page overflow,
  native mobile navigation, settled charts, and readable values.
- A maximum-safe ₹9,00,71,99,25,47,409.91 income in the previous month retained all
  digits and wrapped within the 320px layout; compact chart-axis labels also fit.
- A second account inherited none of the first account's records or totals.

The browser database was dropped and its removal confirmed. The browser and temporary
production verification server were stopped. Docker MongoDB remains available.
Screenshots contain disposable verification records and remain ignored by Git:

- [Desktop](../output/playwright/tallynest-dashboard-desktop.png)
- [Tablet](../output/playwright/tallynest-dashboard-tablet.png)
- [Mobile](../output/playwright/tallynest-dashboard-mobile.png)
- [320px mobile](../output/playwright/tallynest-dashboard-narrow.png)
- [Maximum-safe amount at 320px](../output/playwright/tallynest-dashboard-large-narrow.png)
- [Empty account](../output/playwright/tallynest-dashboard-empty.png)

## Files and limits

Added backend dashboard controller, service, repository, route and validator;
`backend/tests/dashboard.test.js`; `backend/integration/dashboard.mongo.js`;
frontend DashboardPage, DashboardPanels/Charts, dashboard hook/service/utilities/CSS,
two test files and a fixture; `shared/dashboard.js`; and this specification.
Modified app API wiring/error handling/integration script, frontend route wiring,
Vite splitting, dependency metadata/lockfile (Recharts 3.10.1), shared transaction
response-schema export, signed monetary display, existing auth tests, styles import,
and README. Transaction schema/indexes, authentication protocols, ledger styling,
and authentication screens are preserved.

Intentional limits: INR only, four server-selected UTC calendar periods, full calendar
windows rather than elapsed-to-date reports, per-process in-memory rate limits,
manual/focus refresh rather than real-time push, a 5-second MongoDB execution budget,
and no bank balance verification. Raw database writers can bypass transaction write
invariants; matching invalid records cause the dashboard to refuse a summary. Large
aggregates are rejected rather than split or clamped. There is no forecast, budget,
recurrence, group/debt feature, or cloud service. All changes remain uncommitted.
