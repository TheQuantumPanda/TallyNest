# TallyNest — Transaction queries, pagination, and client versions

Phase 2, Step 3 extends the existing transaction CRUD API. Authentication cookies,
CSRF/Origin checks, financial validation, scoped ownership, and atomic version
checks remain in place. No frontend transaction screens or analytics are added.

## Contract changes from Step 2

- Listing now defaults to 20 records instead of the previous bounded 50-record
  history, accepts validated query parameters, and returns pagination metadata.
- Every public transaction includes a nonnegative integer `version`. POST, single
  GET, and successful PATCH additionally return a strong, resource-specific ETag.
- PATCH now requires `If-Match`. Existing transaction clients must retain a fetched
  ETag/version and send it when updating. Missing preconditions return 428, stale
  client versions return 412, and races during an update still return 409.
- CORS permits `If-Match` and exposes `ETag` to the configured frontend origin.

The React application has no transaction client yet, so this step changes no
frontend code. Existing CRUD tests have been updated to send explicit versions.
Authentication endpoint contracts and DELETE behavior are unchanged.

## GET /api/transactions query parameters

Every parameter is optional and validated with Zod. Unknown names, repeated
parameters/arrays, nested query objects, MongoDB operators, arbitrary sort objects,
and unsupported values return 400 `INVALID_QUERY`. All filters combine with AND
and always include the authenticated owner at the database-query level.

| Parameter | Accepted values / behavior | Default |
| --- | --- | --- |
| `type` | `income`, `expense` | No type filter |
| `category` | One stable ID from the central category definition | No category filter |
| `currency` | `INR` only | `INR` |
| `from` | Canonical valid UTC timestamp `YYYY-MM-DDTHH:mm:ss.sssZ`, inclusive | No lower bound |
| `to` | Canonical valid UTC timestamp in the same format, exclusive | No upper bound |
| `search` | Trimmed, nonempty literal title substring, at most 80 characters; case insensitive | No search |
| `sortBy` | `transactionDate`, `amountMinor` | `transactionDate` |
| `sortOrder` | `asc`, `desc` | `desc` |
| `limit` | Decimal integer text 1–100, no signs, whitespace, fractions, or leading zeroes | `20` |
| `cursor` | Opaque server-issued next-page token | First page |

If both type and category are supplied, they must be compatible. A category alone
is allowed without inferring a type, including the shared `other` category.
Both date boundaries are optional; if both exist, `from < to` is required. Date-only
and offset timestamps are rejected. Reporting timezone selection remains explicit
future work: callers must convert local month boundaries to UTC before querying.
Only INR is supported; amounts remain exact positive safe integers in paise and
no currency conversions or cross-currency aggregation occur.

Examples (shown as relative URLs; URL-encode parameters in clients):

```text
/api/transactions
/api/transactions?type=expense&category=food_dining&limit=10
/api/transactions?currency=INR&sortBy=amountMinor&sortOrder=asc
/api/transactions?from=2026-10-01T00%3A00%3A00.000Z&to=2026-11-01T00%3A00%3A00.000Z
/api/transactions?search=lunch&sortBy=transactionDate&sortOrder=desc
```

Listing response:

```json
{
  "status": "ok",
  "data": {
    "transactions": [
      {
        "id": "507f1f77bcf86cd799439033",
        "version": 0,
        "type": "expense",
        "title": "Lunch",
        "amountMinor": 10050,
        "currency": "INR",
        "category": "food_dining",
        "transactionDate": "2026-10-13T07:00:00.000Z",
        "createdAt": "2026-10-13T07:01:00.000Z",
        "updatedAt": "2026-10-13T07:01:00.000Z"
      }
    ]
  },
  "pagination": {
    "limit": 20,
    "hasMore": false,
    "nextCursor": null
  }
}
```

This is an illustrative example. Notes remain optional. No raw owner, `_id`,
`__v`, credentials, or database errors are returned. On empty/final pages,
`hasMore` is false and `nextCursor` is null. There is no total-count query.

## Keyset traversal and cursors

The database fetches `limit + 1` rows, never an entire collection. The extra row
indicates `hasMore`; the next cursor uses the last row actually returned. The sort
field and `_id` always use the same direction:

- Default: `transactionDate DESC, _id DESC`.
- Ascending amount: `amountMinor ASC, _id ASC` (and analogous other modes).
- Next-page comparison: primary field beyond the last value OR equal primary
  value with `_id` beyond the last ID, using `$gt` for ascending and `$lt` for
  descending. Date boundaries and owner filters apply to both comparison branches.

This implements range-based pagination with a unique tie-breaker. See
[MongoDB range-query pagination guidance](https://www.mongodb.com/docs/manual/reference/method/cursor.skip/#using-range-queries).

Cursor wire format is `v1.<base64url(nonce || authenticationTag || ciphertext)>`.
It uses AES-256-GCM with a fresh 12-byte nonce, 16-byte authentication tag, and a
purpose-specific key derived from the existing strong server JWT secret. The
payload contains a format version, authenticated owner, final row ID and sort
value, a hash of normalized filters/sorting, and a 24-hour expiration timestamp.
Payload fields are hidden by encryption; authenticated decryption and strict Zod
payload validation reject malformed or tampered tokens.

Clients must treat cursors as opaque and URL-encode them. Follow the next cursor
with the same effective filters and sorting. Defaults normalize consistently;
page size may change because limit is not part of the binding. Search whitespace
is trimmed, but its spelling/case is part of the binding even though matching is
case insensitive. A change to filters, sorting, owner, expiration, or signing
secret makes the cursor invalid. A malformed query token returns `INVALID_QUERY`;
a token that fails authentication, payload, expiration, or context checks returns
400 `INVALID_CURSOR`. No cursor authorizes access independently of the login cookie.

Each page uses current database state, not a snapshot. New records beyond the
cursor boundary may appear later; records inserted before an already visited
boundary may not appear. Deleted records disappear, and deleting the anchor row
does not prevent continuation because its values are retained in the cursor.
Updates moving a record across the boundary can cause a repeat or omission.
Clients needing a refreshed view should restart without a cursor. Stable,
unchanged data traverses without duplicate/omitted rows across all four sort modes.

## Client-visible optimistic concurrency

Public `version` maps to the existing stored Mongoose version; no new schema field
is introduced. Single-record GET, POST, and PATCH return:

```http
ETag: "tn-507f1f77bcf86cd799439033-v0"
Cache-Control: no-store
```

A PATCH must supply that exact strong resource-specific value:

```http
PATCH /api/transactions/507f1f77bcf86cd799439033
Origin: http://localhost:5173
X-CSRF-Protection: 1
Content-Type: application/json
If-Match: "tn-507f1f77bcf86cd799439033-v0"

{"title":"Updated lunch","notes":null}
```

Clients may construct the documented tag from a listing's `id` and `version`, or
use the ETag from single-record GET. Successful PATCH increments the version and
returns the new version/ETag. Version is not accepted in the body; it and all
other unsupported/internal fields are rejected by strict input schemas.

Only a single strong tag is accepted. Weak tags, wildcards, lists of tags, a tag
for another transaction, invalid syntax, and unsafe version numbers return 400.
The service first retrieves the owner-scoped record, checks the supplied version,
merges the patch, and validates the full result. The repository then performs the
existing atomic owner/ID/version compare-and-set. No silent retry is performed.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_QUERY` | Invalid filters, sort, limit, or query/cursor syntax |
| 400 | `INVALID_CURSOR` | Tampered, expired, or incompatible cursor |
| 400 | `INVALID_VERSION` | Unsupported/malformed If-Match or wrong resource tag |
| 428 | `PRECONDITION_REQUIRED` | Owned record update lacks If-Match |
| 412 | `VERSION_MISMATCH` | Client version is stale when the owned record is read |
| 409 | `TRANSACTION_CONFLICT` | Record changed after validation, before the atomic update |
| 404 | `TRANSACTION_NOT_FOUND` | Missing or foreign-owned transaction; identical response |

Errors retain `{ "status": "error", "code": "...", "message": "..." }`. Existing
401/403/415/429 rules still apply. Ownership is checked before disclosing version
state; foreign/missing records return 404 even with a missing/malformed If-Match.
Authentication and CSRF enforcement precede transaction handling. For 412/409,
reload, review the new state, and submit a deliberate update with its new tag.
This follows [HTTP If-Match strong comparison semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Match).

## Indexes, search costs, and limits

The original `{ owner: 1, transactionDate: -1, _id: -1 }` index is preserved. One
additional `{ owner: 1, amountMinor: -1, _id: -1 }` index supports the newly exposed
amount sort. Each compound index supports reverse scans for its ascending mode.
No indexes for every filter combination or speculative relationships are added.

Title search uses a regex-escaped, case-insensitive literal substring, not a user
regex. Its 80-character cap prevents unbounded input, and listing sets MongoDB
`maxTimeMS: 1000` as an execution budget. Unanchored case-insensitive substring
matching may scan many records within an owner and is not optimized by these
indexes. Selective filters may also require examining many index entries. Search
is suitable for a local application; large datasets need measured query plans and
possibly a different search design. No external search service, full-text index,
or performance benchmark is introduced. Timeouts return sanitized internal errors.

The API provides forward pagination only, no page numbers or counts, and no
snapshot consistency across requests. Rate limits remain per-process/in-memory.
Direct database writers can bypass application validation or version increments;
future writers must participate in the same invariants and concurrency protocol.

## Verification

Run the default database-independent suite and the separate real MongoDB suite:

```bash
npm test --prefix backend
docker compose up -d --wait mongodb
npm run test:mongo --prefix backend
```

Integration uses a unique `tallynest_crud_test_*` database, creates isolated users,
performs actual Express requests against real MongoDB repositories, and drops and
confirms removal of that database afterward. It never loads the development URI.

## Files added and changed

Added:

- `backend/src/validators/transaction-query.validator.js`: strict query, cursor,
  normalized repository option, and If-Match schemas.
- `backend/src/utils/transaction-cursor.js`: authenticated encrypted cursor codec.
- `backend/tests/transaction-query.test.js`: query API and cursor/repository unit tests.
- `backend/tests/helpers/transaction-query-api.js`: shared query/version HTTP contracts.
- `backend/tests/helpers/transaction-repository.js`: extracted isolated repository double.
- `docs/phase-2-step-3.md`: current query and version contract.

Modified:

- `backend/app.js`: pass cursor key configuration; allow If-Match and expose ETag.
- `backend/src/controllers/transaction.controller.js`: pagination envelope and ETags.
- `backend/src/services/transaction.service.js`: pagination orchestration and client versions.
- `backend/src/repositories/transaction.repository.js`: validated efficient scoped keyset reads.
- `backend/src/models/transaction.model.js`: amount sort index only; schema fields unchanged.
- `backend/tests/helpers/transaction-api.js`: existing CRUD/concurrency tests send versions.
- `backend/tests/transaction-api.test.js`: updated listing tests and shared test double.
- `backend/tests/transaction.test.js`: index declarations include the new amount index.
- `backend/integration/transactions.mongo.js`: shared query/version contracts and live index check.
- `README.md` and `docs/phase-2-step-2.md`: current contract links and historical context.

## Executed results — 2026-10-13

| Check | Result |
| --- | --- |
| `npm test --prefix backend` | 165 passed; existing tests retained and adapted for explicit contract changes |
| `npm run test:mongo --prefix backend` | 30 passed, zero failures/skips |
| `npm test --prefix frontend` | 36 passed in 4 files |
| `npm run lint --prefix backend` | Passed, zero warnings |
| `npm run lint --prefix frontend` | Passed, zero warnings |
| `npm run format:check --prefix frontend` | Passed; backend has no configured Prettier check |
| `npm audit --omit=dev --prefix backend` | 0 vulnerabilities |
| `npm audit --omit=dev --prefix frontend` | 0 vulnerabilities |
| `git diff --check` | Passed |

The final real-MongoDB database was
`tallynest_crud_test_1791874410513_591d8c0a321a`; the suite confirmed it was dropped.
It verified filtering, literal search, four-sort cursor traversal with duplicate
values, owner isolation, real index existence, exact persisted amounts, deletion
of a cursor anchor, explicit client preconditions, and server-side atomic conflicts.
Development data and `.env` configuration were untouched. No dependencies were
added and no frontend files changed. All changes remain uncommitted.
