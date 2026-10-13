# TallyNest — Monthly personal budgeting backend

Phase 3, Step 1 adds independent monthly expense-category budget records and
owner-scoped CRUD. There is no budget UI, rollover, recurring setting, spending
analytics, or automatic transaction creation. Existing transactions, dashboard,
authentication contracts, and shared monetary representation remain unchanged.

## Schema and integrity

| Field | Stored representation | Rules |
| --- | --- | --- |
| `owner` | ObjectId, User reference | Required, immutable; derived exclusively from authenticated user |
| `category` | Stable string identifier | Existing expense category, including `other`; income-only categories rejected |
| `currency` | String | INR only, defaults to INR |
| `amountMinor` | Number containing an exact integer | Positive safe integer paise, 1–9007199254740991 |
| `month` | String `YYYY-MM` | Canonical UTC calendar month; years 0001–9999, months 01–12 |
| `createdAt`, `updatedAt` | BSON Date | Mongoose-managed UTC timestamps |
| `__v` | Integer version | Internal storage; public field is `version` |

The central category source remains `shared/transaction.constants.js`, re-exported
by the backend's existing constants module. Budgets reuse the transaction amount
and currency schemas; no competing money format or category list is introduced.
₹100.50 is `amountMinor: 10050`. Decimal text can be converted using existing
`majorToMinor`; there is no float multiplication, rounding, or sum of budget limits.
Zero, negatives, fractions, strings, booleans, null, NaN/Infinity, and unsafe limits
are rejected. Setters validate before Mongoose casting, and repositories validate
the complete document before persistence. Fields cannot be cleared with null.

Each month is an independent record. Creating October's budget never creates a
November budget or an expense. Historical and future months are allowed. The key
identifies UTC `[month start, next month start)` for future spending integration;
it does not use the host's local calendar or imply a bank balance.

One unique compound index enforces:

```js
{ owner: 1, month: 1, currency: 1, category: 1 }
```

A user can have only one record in each category/currency/month slot. Different
owners, categories, or months are independent. The same index supports the
owner/month/currency listing ordered by category. No extra standalone indexes or
speculative fields are added. Server startup awaits budget index initialization
before accepting traffic. Duplicate writes, including races and PATCH changes
into an occupied slot, return 409 `BUDGET_EXISTS` without exposing driver details.

## API

All routes require the existing JWT HTTP-only cookie and live user lookup.
POST/PATCH/DELETE require exact configured `Origin` and `X-CSRF-Protection: 1`;
POST/PATCH also require `Content-Type: application/json`. Existing CORS permits
credentials and If-Match and exposes ETag. No authentication contract changes.
Responses are `Cache-Control: no-store`. A per-owner in-memory limiter allows 300
budget requests per 15 minutes, resets on restart, and is not a distributed quota.

| Method | Endpoint | Result |
| --- | --- | --- |
| POST | `/api/budgets` | 201 `{ status: "ok", data: { budget } }`, ETag |
| GET | `/api/budgets?month=2026-10` | 200 `{ status: "ok", data: { budgets: [] } }` |
| GET | `/api/budgets/:id` | 200 public budget, ETag |
| PATCH | `/api/budgets/:id` | 200 updated public budget, new ETag; If-Match required |
| DELETE | `/api/budgets/:id` | 200 `{ status: "ok", message: "Budget deleted" }` |

The detail/update/delete routes use `:id`, completing the identifier omitted in
the task's route list. GET listing requires `month`; optional `currency` defaults
to INR and `category` narrows the month. Unknown names, repeated values, invalid
months, income categories, unsupported currencies, and MongoDB operators return
400 `INVALID_QUERY`. Results sort by category ascending. Monthly uniqueness
naturally bounds results to the expense-category count (currently 11); there is
no cross-month history, truncation-based pagination, or arbitrary MongoDB query.
The repository adds a category-count safety cap and a 1-second execution budget.

Create example:

```http
POST /api/budgets
Origin: http://localhost:5173
X-CSRF-Protection: 1
Content-Type: application/json

{"category":"food_dining","currency":"INR","amountMinor":150000,"month":"2026-10"}
```

Illustrative public budget:

```json
{
  "id": "507f1f77bcf86cd799439033",
  "version": 0,
  "category": "food_dining",
  "currency": "INR",
  "amountMinor": 150000,
  "month": "2026-10",
  "createdAt": "2026-10-13T09:00:00.000Z",
  "updatedAt": "2026-10-13T09:00:00.000Z"
}
```

Public responses select fields explicitly; they omit owner, `_id`, `__v`, and all
credentials. Create requires category, amountMinor and month; currency defaults.
PATCH accepts a nonempty subset of category, currency, amountMinor and month.
It merges with existing values and validates the entire result. All other fields,
including owner, IDs, timestamps, body version and MongoDB operators, are rejected.

## Ownership and concurrency

Every repository lookup, listing, CAS update, and deletion includes authenticated
owner in its MongoDB query. There is no unscoped lookup followed by an ownership
check. Malformed ObjectIds return 400 `INVALID_BUDGET_ID`. Missing and foreign-owned
records have identical 404 `BUDGET_NOT_FOUND` responses, including PATCH with no
If-Match. Ownership is resolved before exposing version state.

POST/single GET/PATCH use the existing resource-version ETag convention:

```http
ETag: "tn-507f1f77bcf86cd799439033-v0"
```

Update example:

```http
PATCH /api/budgets/507f1f77bcf86cd799439033
Origin: http://localhost:5173
X-CSRF-Protection: 1
Content-Type: application/json
If-Match: "tn-507f1f77bcf86cd799439033-v0"

{"amountMinor":200000}
```

The existing If-Match validator is reused. Only one strong, matching resource tag
is accepted: no wildcard, weak tag, tag list, unsafe version, or other resource ID.
Missing header returns 428 `PRECONDITION_REQUIRED`; malformed/wrong-resource header
400 `INVALID_VERSION`; a stale version 412 `VERSION_MISMATCH`. After full validation,
the repository atomically matches owner + ID + `__v`, sets editable values and
increments `__v`. A lost compare-and-set returns 409 `BUDGET_CONFLICT` (or 404 if the
owned record disappeared). Exhausted safe version counters also return conflict.
No silent retries or lost-update overwrites. Reload and review before deliberately
submitting the new version. Mongoose optimistic concurrency also guards ordinary
document saves; HTTP writes use explicit CAS.

DELETE is a hard, ownership-scoped deletion with no If-Match requirement, matching
the existing transaction API. A concurrent PATCH and DELETE can leave a deleted
record, but cannot resurrect it. Re-creating its monthly slot is allowed afterward.

Errors use `{ status: "error", code, message }`; expected additional statuses are
401 `AUTH_REQUIRED`, 403 `CSRF_REJECTED`, 415 `JSON_REQUIRED`, 429 `RATE_LIMITED`.
Unexpected failures return sanitized 500 `INTERNAL_ERROR` in every environment.
Raw driver details, credentials and stack traces are never returned or logged here.

## Verification — 2026-10-13

Default unit/HTTP tests require no MongoDB. The new budget contract is run against
both isolated repository doubles and actual MongoDB. The integration suite creates
real disposable users, uses the actual JWT middleware and MongoDB user lookup,
and verifies budgets through HTTP plus direct persistence checks.

Commands:

```bash
npm test --prefix backend
npm test --prefix frontend
docker compose up -d --wait mongodb
npm run test:mongo --prefix backend
npm run lint --prefix backend
npm run lint --prefix frontend
npm run format:check --prefix frontend
npm audit --omit=dev --prefix backend
npm audit --omit=dev --prefix frontend
git diff --check
```

Executed results (all passed, no skipped tests):

| Check | Result |
| --- | --- |
| Backend isolated tests | 194 passed: 178 preserved plus 16 budget tests |
| Frontend regression tests | 93 passed across 9 files |
| Real MongoDB integration | 48 passed: 35 preserved plus 13 budget checks |
| Backend/frontend ESLint | Passed, zero warnings |
| Configured frontend Prettier | Passed; backend has no configured Prettier check |
| Production dependency audits | 0 vulnerabilities in both packages |
| `git diff --check` | Passed |

The final integration databases were
`tallynest_budget_test_1791883437106_1649985ea9b0`,
`tallynest_dashboard_test_1791883437024_9b8a81bb`, and
`tallynest_crud_test_1791883437112_0c246a6619a0`.
All three were dropped and confirmed absent. Docker MongoDB remains running.
No new packages were needed. A frontend production build/browser check was not
run for this backend-only step; frontend tests/lint/formatting were run.

The suites cover valid creation, exact integer boundaries, expense categories,
month keys, all invalid amounts, protected fields/operator injection, monthly
uniqueness, concurrent creates, owner isolation, listing/retrieval, versioned
updates, stale versions, racing updates, duplicate-slot moves, hard deletion,
authentication, CSRF, JSON requirements, safe errors, model constraints and indexes.
Real MongoDB verifies the actual unique index, duplicate-key errors, exact amount
persistence, owner round trips, and unchanged transaction document
values after budget create/update/delete. All test databases are uniquely named,
use local Docker MongoDB only, never read `.env`, and are dropped with removal
confirmed. Development financial data is never read or modified by these suites.

## Files and future integration

Added model, validator, repository, service, controller and routes under
`backend/src`; `backend/tests/budget.test.js`, `backend/tests/helpers/budget-api.js`,
`backend/integration/budgets.mongo.js`, and this specification. Modified API wiring,
server index initialization, private error handling, integration test script and
README. No new dependencies or frontend/UI changes.

Future spending analytics can match personal expense transactions by authenticated
owner, category and INR using the month's UTC half-open interval. Such aggregation
must reuse the existing exact monetary rules, check unsafe totals, and never mix
currencies. This step implements none of that analytics, rollover, recurring
creation, overspending notifications, or budget carry-forward.

Limitations: INR only; explicit month required for listing; no cross-month history
endpoint or budget analytics. MongoDB references do not enforce foreign keys;
authentication verifies the account for HTTP requests. Raw collection writes can
bypass Mongoose validation and must not be used as an application write path.
Rate limiting remains in-process. No frontend or browser budgeting verification
is applicable because this step adds backend functionality only.
