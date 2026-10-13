# TallyNest — Transaction foundation

This document records the Step 1 implementation snapshot. Current CRUD behavior
and subsequent live integration verification are documented in [Step 2](phase-2-step-2.md).

Phase 2, Step 1 implements a personal transaction schema, Zod 4 validation, exact
money utilities, central categories, and ownership-scoped read primitives. There
are no transaction endpoints, controllers, services, frontend changes, or scheduled
jobs. Existing authentication and response contracts are unchanged.

## Schema and future JSON input contract

| Field | Stored type | Rules |
| --- | --- | --- |
| `owner` | ObjectId referencing User | Required, immutable; supplied from authenticated user context |
| `type` | String | `income` or `expense` |
| `title` | String | Required descriptive title, trimmed, 1–200 characters |
| `amountMinor` | Number containing an integer | Required, 1 through 9007199254740991 inclusive |
| `currency` | String | `INR` only, default `INR` |
| `category` | String | Central stable identifier compatible with type |
| `transactionDate` | BSON Date | Required UTC instant; separate from record creation time |
| `notes` | String | Optional, trimmed, up to 2000 characters; empty allowed, null rejected |
| `createdAt`, `updatedAt` | BSON Date | Managed by Mongoose timestamps |

Proposed future request body (no endpoint exists yet):

```json
{
  "type": "expense",
  "title": "Lunch",
  "amountMinor": 10050,
  "currency": "INR",
  "category": "food_dining",
  "transactionDate": "2026-10-13T07:00:00.000Z",
  "notes": "Team lunch"
}
```

`transactionInputSchema` rejects unknown fields, including `owner`, timestamps,
and legacy `amount`. `transactionDocumentSchema` additionally requires an owner
as a 24-character hexadecimal string. Internal Mongoose construction also accepts
an ObjectId owner and a valid Date object. Ownership validity is syntactic: neither
schema verifies a user's existence or authentication. Future services must derive
the owner from the authenticated session and call the repository with that ID.

## Financial integrity

All monetary values are integers in minor units. INR uses 100 paise per rupee:
₹100.50 → 10050; ₹1.00 → 100. No floating-point major-unit values are stored.
Mongoose Number uses JavaScript numbers, whose integer values are exact within
the enforced safe range. Setters validate before Mongoose coercion, so strings,
booleans, fractional values, zero, negative amounts, NaN, Infinity, and unsafe
integers are rejected even when constructing the model directly.

`majorToMinor(decimalText, currency)` accepts unsigned decimal text with up to two
fractional digits and uses BigInt arithmetic before a checked Number conversion.
It rejects signs, whitespace, leading zeroes except zero itself, exponents,
separators, numeric input, unsupported precision (including `1.000`), and overflow.
It never rounds. `minorToMajor` produces a fixed two-place decimal string;
`formatMoney` prefixes the INR symbol without locale-dependent grouping.
For example `formatMoney(10050)` is `₹100.50` on every host. Display utilities allow
zero and signed safe integers for balances; transaction schemas still require a
positive amount. Decimal text conversion accepts zero but rejects negative input.

Currencies are defined centrally with their minor precision and display symbol.
Only INR is currently supported. There is no exchange-rate support or aggregation
implementation. Future sums and settlements must check overflow and require the
same currency for all operands; adding currency metadata alone does not make
cross-currency arithmetic valid.

## Categories

The only category source is `src/constants/transaction.constants.js`.

| Type | Stable identifiers and labels |
| --- | --- |
| Expense | `food_dining` Food & Dining; `shopping` Shopping; `transportation` Transportation; `housing` Housing; `utilities` Utilities; `healthcare` Healthcare; `education` Education; `entertainment` Entertainment; `subscriptions` Subscriptions; `travel` Travel |
| Income | `salary` Salary; `freelance` Freelance; `business` Business; `investments` Investments; `gifts` Gifts |
| Both | `other` Other |

Both Zod and full Mongoose document validation enforce category/type compatibility.
Labels may evolve without changing stored identifiers. Neither layers nor clients
should maintain a competing category list.

## Dates, ownership, and indexes

Public validation requires exactly `YYYY-MM-DDTHH:mm:ss.sssZ` with a four-digit
year, a valid calendar date and a real UTC time. Date-only strings, local timestamps,
offset strings, invalid leap days, rollover dates, leap seconds, and numeric
timestamps are rejected. Callers must explicitly convert local instants to UTC.
BSON Date stores the instant; it does not retain a timezone. Future monthly
reporting must use an explicit IANA reporting timezone (for example Asia/Kolkata),
then convert local month boundaries to UTC for half-open range queries. Do not
use the host timezone or assume UTC months equal user-local months.

The repository exposes only `findByIdForOwner(ownerId, transactionId)` and
`findForOwner(ownerId, { from, to, limit })`. Every query contains a mandatory,
validated owner. Callers cannot pass arbitrary MongoDB filters or operators.
Missing ownership is rejected before any query. Dates use inclusive `from` and
exclusive `to`, with strictly increasing ranges. History is bounded to 1–100
records (default 50) and sorted by date descending, then `_id` descending.
An ID belonging to another owner returns no match via the combined query.

The schema declares one compound index `{ owner: 1, transactionDate: -1, _id: -1 }`
in addition to MongoDB's automatic `_id` index. Its owner prefix supports owner-only
queries; the date and ID keys support scoped chronological ordering and ranges.
No redundant owner-only or unscoped global date index is added. There is no query
performance measurement or live index-creation verification in this step.

## Limits and future extensions

Mongoose constraints protect normal document validation/save paths, not raw MongoDB
writes. There is no database collection validator. Query updates and bulk writes
can bypass validation or lack the full document needed for category checks; no
write repository methods are exposed yet. Future updates must validate the complete
merged document and preserve trusted ownership, rather than assume partial update
validators are sufficient. See [Mongoose validation documentation](https://mongoosejs.com/docs/validation.html).

No CRUD HTTP routes, recurrence fields, group associations, budgets, settlement
rules, or analytics are implemented. Future features can reference transaction IDs
and reuse owner, currency, timestamp, and integer amounts. Additional indexes or
relationships should follow actual access patterns. Referential existence checks,
write authorization, pagination, per-currency aggregation, and explicit reporting
timezone selection belong to those later stages.

## Verification approach

Node's built-in test runner uses actual Mongoose document validation without a
connection, and repository doubles capture filters and reject unsafe inputs before
querying. It covers money boundaries, all categories/type combinations, date
rollover, ownership, optional fields, schema/index declarations, and scoped reads.
No development database is connected or modified. Frontend regression tests use
the existing mocked API suite. Live persistence, index creation, and query plans
are not covered by these tests.

## Executed checks (2026-10-13)

| Check | Result |
| --- | --- |
| `npm test --prefix backend` | 128 passed: 32 existing and 96 new; no failures or skips |
| `npm test --prefix frontend` | 36 passed across 4 files |
| `npm run lint --prefix backend` | Passed, zero warnings |
| `npm run lint --prefix frontend` | Passed, zero warnings |
| `npm run format:check --prefix frontend` | Passed; backend has no configured Prettier check |
| `npm audit --omit=dev --prefix backend` | 0 vulnerabilities |
| `npm audit --omit=dev --prefix frontend` | 0 vulnerabilities |
| `git diff --check` | Passed |

No new dependencies were needed. Live MongoDB persistence and index creation were
not run; no database contents, `.env` files, frontend files, or authentication
contracts were changed. All changes remain uncommitted.
