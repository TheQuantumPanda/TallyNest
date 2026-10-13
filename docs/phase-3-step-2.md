# TallyNest — Monthly budget spending analytics

Phase 3, Step 2 adds a read-only personal budget summary. Budget/transaction schemas,
CRUD/If-Match contracts, authentication, and UI remain unchanged. There is no budget
frontend, recurrence, notification, bank integration, or transaction generation.

## Endpoint and validation

```http
GET /api/budgets/summary?month=2026-10&currency=INR
```

Requires the existing HTTP-only JWT cookie and current-user lookup. `month` is
mandatory: canonical `YYYY-MM`, years 0001–9999 and months 01–12. Currency defaults
to INR; other currencies are rejected. Only `month` and `currency` are permitted.
Unexpected names, owner overrides, category filters, repeated parameters, arrays,
nested objects, and MongoDB operators return 400 `INVALID_QUERY`. There is no
partial-category filter that could conceal unbudgeted spending.

The static `/summary` GET is registered before `/:id`. It inherits existing
budget authentication, per-owner rate limiting (300/15 minutes), safe error codes,
and `Cache-Control: no-store`. GET does not mutate state or require a CSRF header.
Existing POST/PATCH/DELETE CSRF and Origin checks remain unchanged.

Success is `{ status: "ok", data: { summary } }`. Illustrative response:

```json
{
  "status": "ok",
  "data": {
    "summary": {
      "month": "2026-10",
      "currency": "INR",
      "reportingTimezone": "UTC",
      "consistency": "best_effort",
      "period": {
        "from": "2026-10-01T00:00:00.000Z",
        "to": "2026-11-01T00:00:00.000Z"
      },
      "budgets": [
        {
          "id": "507f1f77bcf86cd799439033",
          "version": 0,
          "category": "food_dining",
          "currency": "INR",
          "month": "2026-10",
          "limitMinor": 10000,
          "spentMinor": 12000,
          "remainingMinor": -2000,
          "overspentMinor": 2000,
          "utilizationBasisPoints": 12000,
          "status": "over_budget"
        },
        {
          "id": "507f1f77bcf86cd799439044",
          "version": 0,
          "category": "other",
          "currency": "INR",
          "month": "2026-10",
          "limitMinor": 5000,
          "spentMinor": 0,
          "remainingMinor": 5000,
          "overspentMinor": 0,
          "utilizationBasisPoints": 0,
          "status": "unused"
        }
      ],
      "unbudgetedCategories": [
        { "category": "shopping", "spentMinor": 3000 }
      ],
      "totals": {
        "budgetLimitMinor": 15000,
        "budgetedSpendingMinor": 12000,
        "unbudgetedSpendingMinor": 3000,
        "expenseMinor": 15000,
        "remainingMinor": 3000,
        "overspentMinor": 2000
      },
      "counts": {
        "budgetCount": 2,
        "unbudgetedCategoryCount": 1,
        "expenseTransactionCount": 3,
        "statuses": {
          "unused": 1,
          "within_budget": 0,
          "at_limit": 0,
          "over_budget": 1
        }
      }
    }
  }
}
```

Arrays sort by stable category identifier ascending. Every configured budget is
returned, including categories with no spending. Unbudgeted categories contain
only positive matching expenses; no fabricated zero rows. `version` can be used
with the unchanged budget CRUD ETag convention. Owner, `_id`, `__v`, credentials,
raw database errors, and stack traces are never exposed.

## Financial rules

All `*Minor` fields are safe integer paise; they use the existing monetary contract.
Per budget: `remainingMinor = limitMinor - spentMinor` (possibly negative), and
`overspentMinor = max(spentMinor - limitMinor, 0)`. Neither is bank cash or balance.

Statuses use exact spending, never a rounded display percentage:

| Status | Definition |
| --- | --- |
| `unused` | Spending is zero |
| `within_budget` | Spending is positive and strictly below limit |
| `at_limit` | Spending equals limit |
| `over_budget` | Spending exceeds limit |

Utilization is integer basis points: 10000 means 100%, 12000 means 120%.
It is computed with BigInt as `(spent * 10000 + floor(limit / 2)) / limit`,
rounded half up. Positive limits prevent division by zero. No 100% clamp is
applied. A tiny positive spend may round to 0 basis points while retaining the
exact `within_budget` status and monetary amount. Future bars may cap geometry,
but must retain the uncapped ratio/figures for labels.

Totals are calculated server-side with BigInt:

- `budgetLimitMinor`: sum of configured budget limits.
- `budgetedSpendingMinor`: expense totals in configured categories.
- `unbudgetedSpendingMinor`: expense totals in all remaining categories.
- `expenseMinor`: total matched monthly personal expenses.
- `remainingMinor`: aggregate limits minus budgeted spending. Unbudgeted expenses
  are separate; they do not imply an allowance in an unconfigured category.
- `overspentMinor`: sum of per-category overspending, not the positive part of
  aggregate spending minus aggregate limits. Surplus in one category cannot hide
  another exceeded limit. Thus a positive total remaining and positive overspent
  amount can coexist, as in the example.

Budgeted plus unbudgeted spending must equal monthly expenses exactly. Category
sums and transaction counts also reconcile with an independently grouped facet.
`counts.statuses` counts budgets in each status; their sum equals `budgetCount`.
A month without budgets still exposes every matching expense as unbudgeted.
A month without either returns zero totals/counts and empty arrays.

Unsafe monetary totals **or utilization basis points** return 422
`SUMMARY_OVERFLOW`; no rounded, clamped, Infinity, unsafe JSON number, or partial
summary is returned. For example a one-paise budget with maximum-safe spending
has safe monetary values but an unsafe numeric basis-point ratio, so is rejected.
Matching corrupt financial records return 422 `SUMMARY_DATA_INVALID`, and
unreconciled aggregate facets return 422 `SUMMARY_INCONSISTENT`. Ordinary auth,
rate-limit, and sanitized internal error conventions are unchanged.

## UTC boundaries and aggregation

The month is `[00:00:00.000Z on day 1, 00:00:00.000Z on next month's day 1)`.
Start is inclusive and end exclusive, including leap years and December rollover.
The parser avoids JavaScript Date.UTC's year-0–99 remapping; December 9999's
exclusive boundary uses the valid extended-year ISO form `+010000-01-01...`.
No host-local or browser-local timezone enters the query.

Exactly two database operations per summary, both owner-scoped:

1. Read matching monthly/currency budgets, ordered by category. The small result
   is bounded to expense-category count + 1 to detect corrupt extra rows.
2. Aggregate matching owner + expense type + currency + UTC date range in MongoDB.
   One `$facet` computes financial integrity, exact total/count, and category sums.
   Individual transactions are never loaded into application memory.

Income never offsets expenses. Other owners, dates and currencies are outside the
matching dataset and never contribute. Matching expense amounts must be numeric,
positive, safe integers with a compatible category and scalar ObjectId owner/BSON
Date. Raw strings, fractions (including Decimal128 fractions), NaN/Infinity,
unsafe values, income categories, and array owner/date references fail closed.
Returned budgets are validated with existing Zod rules and checked for owner,
month, currency, safe version, and duplicate categories before calculations.

The dashboard's Int64-to-Decimal128 conversion and monetary/category integrity
expressions were extracted to a reused backend helper without changing dashboard
behavior. Each source amount converts through Int64 before Decimal128 `$sum`,
retaining all safe integer digits; integrity rejects conversion truncation.
Aggregate integer strings are then read as BigInt and checked before JSON Number
conversion. The shared percentage helper now exposes its existing half-up ratio
calculation as a BigInt result; dashboard formatting/geometry remain unchanged.

No new indexes. Transactions reuse `{ owner: 1, transactionDate: -1, _id: -1 }`;
type/currency are residual filters. Budgets reuse the unique
`{ owner: 1, month: 1, currency: 1, category: 1 }` index. No per-category queries,
arbitrary filters, or speculative compound indexes. Query budgets remain 1 second
for budgets and 5 seconds for aggregation; expensive/time-out failures are safe
500 responses. This is not a measured large-dataset performance guarantee.

## Consistency and limitations

`consistency: "best_effort"` explicitly means **no cross-collection point-in-time
snapshot**. Budget and expense reads run concurrently. A concurrent budget change
may be reflected before/after a transaction change, so a summary can legitimately
combine an old limit with newer expenses. Expense total/category/count facets use
the same matched stream, and all returned financial partitions reconcile, but
that does not promise database snapshot isolation. Reload to see subsequent
changes; no locks, transactions, background jobs, or silent CRUD retries are added.

A deterministic real-Mongo test captures the old budget, then updates its limit and
adds an expense before aggregating: the first summary reflects that mixed-age view,
and the next reflects current state. Both reconcile exactly.

INR only; explicit single-month reporting; no carry-forward or recurring settings.
Validation covers matching financial records, not a collection-wide corruption
audit. Records with absent/unassignable dates, a different currency, or a non-expense
type cannot be attributed to this scoped expense period and are outside its input.
No schemas, financial data, authentication contracts, or frontend UI were changed.

## Executed verification — 2026-10-13

| Check | Result |
| --- | --- |
| Backend unit/HTTP tests | 210 passed (194 existing + 16 new), zero failures/skips |
| Real MongoDB integration | 56 passed (48 existing + 8 new), zero failures/skips |
| Frontend regression tests | 93 passed across 9 files |
| Backend/frontend/shared ESLint | Passed, zero warnings |
| Configured frontend/shared Prettier | Passed; no backend Prettier check configured |
| Production dependency audits | Zero vulnerabilities in both packages |
| `git diff --check` | Passed |

Commands: `npm test --prefix backend`, `npm test --prefix frontend`,
`docker compose up -d --wait mongodb`, `npm run test:mongo --prefix backend`,
`npm run lint --prefix backend`, `npm run lint --prefix frontend`,
`npm run format:check --prefix frontend`, both `npm audit --omit=dev` commands,
shared-file ESLint/Prettier checks, and `git diff --check`.

The final integration databases were:

- `tallynest_budget_summary_test_1791886551433_c5440a2b58e7`
- `tallynest_budget_test_1791886551298_12fff5badd21`
- `tallynest_dashboard_test_1791886551055_e7137cde`
- `tallynest_crud_test_1791886551640_ff36d0c280ae`

All were dropped and confirmed absent. Tests use disposable real users, MongoDB
budgets/transactions, and actual authenticated HTTP for the new endpoint. The
isolated unit suite needs no MongoDB. Neither suite reads `.env` or development
financial data. Docker MongoDB remains running. No dependencies were added.
Frontend build/browser checks were not run for this backend-only step.

## Added and modified files

Added `backend/src/controllers/budget-summary.controller.js`,
`backend/src/services/budget-summary.service.js`,
`backend/src/repositories/budget-summary.repository.js`,
`backend/src/utils/financial-aggregation.js`, `backend/tests/budget-summary.test.js`,
`backend/integration/budget-summary.mongo.js`, and this specification.
Modified `backend/app.js`, budget routes/validators, dashboard repository (shared
aggregation extraction), `shared/dashboard.js`, the Mongo integration script in
`backend/package.json`, README, and the Step 1 documentation cross-reference.
All changes are left uncommitted for review.
