# TallyNest — Personal transaction API

Phase 2, Step 2 implements authenticated personal transaction CRUD using
Controller → Service → Repository → Model. The existing schema, money utilities,
category definitions, compound index, JWT cookies, and authentication contracts
are preserved. There are no frontend transaction pages or financial summaries.

## Endpoints

All paths require a valid access cookie for an existing user. Browser clients use
`withCredentials: true` / `credentials: 'include'`. POST, PATCH, and DELETE require
an exact `Origin` matching `CLIENT_ORIGIN` and `X-CSRF-Protection: 1`. POST and PATCH
also require `Content-Type: application/json`. CORS preflight now permits PATCH
and DELETE as well as the existing methods.

| Method | Path | Success |
| --- | --- | --- |
| POST | `/api/transactions` | 201 `{ "status": "ok", "data": { "transaction": ... } }` |
| GET | `/api/transactions` | 200 `{ "status": "ok", "data": { "transactions": [...] } }` |
| GET | `/api/transactions/:id` | 200 `{ "status": "ok", "data": { "transaction": ... } }` |
| PATCH | `/api/transactions/:id` | 200 `{ "status": "ok", "data": { "transaction": ... } }` |
| DELETE | `/api/transactions/:id` | 200 `{ "status": "ok", "message": "Transaction deleted" }` |

History returns at most **50** records, sorted by `transactionDate` descending,
then `_id` descending. It can return an empty array. Query parameters are rejected
with 400; client filtering, selectable limits, and pagination belong to Step 3.
There is no total count or pagination metadata at this stage. ID parameters must
be 24-character hexadecimal MongoDB ObjectIds.

## Create, update, and response contract

Creation body:

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

Income uses `type: "income"` and a compatible category such as `salary`. See the
[foundation specification](phase-2-step-1.md) and the central category definition
in `backend/src/constants/transaction.constants.js` for all IDs and labels.

A successful create/read/update returns this transaction shape:

```json
{
  "status": "ok",
  "data": {
    "transaction": {
      "id": "507f1f77bcf86cd799439033",
      "type": "expense",
      "title": "Lunch",
      "amountMinor": 10050,
      "currency": "INR",
      "category": "food_dining",
      "transactionDate": "2026-10-13T07:00:00.000Z",
      "notes": "Team lunch",
      "createdAt": "2026-10-13T07:01:00.000Z",
      "updatedAt": "2026-10-13T07:01:00.000Z"
    }
  }
}
```

This example is illustrative documentation, not application financial data.
The serializer explicitly allows public fields only. It excludes owner, raw `_id`,
internal `__v`, password hashes, JWTs, and database internals. All dates are UTC ISO
strings. Absent notes are omitted from response JSON.

`amountMinor` is a JSON number containing a positive safe integer, from 1 through
9007199254740991 inclusive. For INR it is paise: ₹100.50 is 10050. Strings,
fractional numbers, zero, negatives, nonfinite numbers, and unsafe integers are
invalid. There is no floating-point rupee conversion or silent rounding. JSON
itself cannot represent NaN/Infinity; direct service validation also rejects them.
Only INR is supported, with INR defaulted on creation when omitted. No currency
conversion or aggregation is performed.

Titles are trimmed and must be 1–200 characters. Notes are trimmed and at most
2000 characters. Type, category compatibility, and canonical real UTC timestamps
(`YYYY-MM-DDTHH:mm:ss.sssZ`) follow the existing shared Zod schemas. Invalid calendar
dates, date-only values, and timezone-offset strings are rejected. Reporting still
requires an explicit future reporting timezone.

PATCH accepts a nonempty subset of the seven editable fields. It rejects unknown
fields and merges the patch with the current record before validating the entire
result. Changing expense to income may require changing category in the same patch:

```json
{ "type": "income", "category": "salary", "amountMinor": 250000 }
```

Omitted fields remain unchanged, including currency and notes. `notes: null`
explicitly removes stored notes; `notes: ""` stores an empty string. Null notes are
accepted only for PATCH, not creation. Empty patches, protected fields (`owner`,
`_id`, `id`, `createdAt`, `updatedAt`, `__v`), arbitrary fields, and MongoDB operators
such as `$set`/`$inc` are rejected. Owner comes exclusively from the authenticated
user; it is never taken from request data.

## Authorization, concurrency, and errors

Every application read, update, and delete is scoped by owner in the actual MongoDB
query. ID lookups combine owner and transaction ID. Missing and foreign-owned
records receive identical 404 status and body. Deletion is a hard, atomic,
owner-scoped deletion. No unscoped lookup is used for authorization.

Updates first read the owned document, merge and validate all invariants, and
validate a full Mongoose document. The atomic update filters by owner, ID, and the
read version (`__v`), writes only the validated editable fields, increments `__v`,
and lets Mongoose manage `updatedAt`. The original schema already has `__v`; no
schema fields or indexes were added. A stale snapshot cannot overwrite a concurrent
update. A conflict returns 409; if the record was deleted, it returns 404 instead.
Clients should reload and reconsider/retry their patch. This protects concurrent
server operations; detecting edits based on a client's earlier GET is future work
because no client-supplied version/ETag contract is introduced here.

The code deliberately does not rely on partial Mongoose update validators for
category/type consistency. It validates a complete document before the atomic
compare-and-set update. Ordinary CRUD uses no multi-document database transactions
or locks. All future writers must participate in version increments; raw database
writes can bypass these application safeguards.

Transaction errors use `{ "status": "error", "code": "...", "message": "..." }`.
The existing authentication endpoint response format is unchanged.

| HTTP | Transaction error code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_TRANSACTION` | Invalid creation, patch, or merged state |
| 400 | `INVALID_TRANSACTION_ID` | Invalid path ObjectId |
| 400 | `INVALID_QUERY` | Unsupported query parameters |
| 400 | `INVALID_REQUEST` | Malformed JSON |
| 401 | `AUTH_REQUIRED` | Missing, invalid, expired cookie or removed account |
| 403 | `CSRF_REJECTED` | Missing CSRF header or untrusted/missing Origin |
| 404 | `TRANSACTION_NOT_FOUND` | Missing or foreign-owned transaction |
| 409 | `TRANSACTION_CONFLICT` | Concurrent update; reload and retry |
| 413 | `BODY_TOO_LARGE` | Existing 100kb JSON limit exceeded |
| 415 | `JSON_REQUIRED` | POST/PATCH body is not JSON |
| 429 | `RATE_LIMITED` | Transaction request limit exceeded |
| 500 | `INTERNAL_ERROR` | Generic internal failure |

Responses set `Cache-Control: no-store`. Internal error messages and stacks are
hidden on transaction paths in every environment. No credentials, cookies, or
payloads are logged. Transaction routes allow 300 requests per authenticated user
per 15 minutes in memory, per app process; a shared rate-limit store would be needed
for multiple instances. Existing authentication rate limits remain unchanged.

## Manual requests

Log in using the README authentication example and retain the private temporary
cookie jar before logging out. Use the actual ID returned by POST for later paths.
These requests write to whichever database your running server uses; automated
integration verification below uses only a disposable database.

```bash
curl -b "$AUTH_COOKIE_JAR" -H 'Origin: http://localhost:5173' \
  -H 'X-CSRF-Protection: 1' -H 'Content-Type: application/json' \
  -d '{"type":"expense","title":"Lunch","amountMinor":10050,"category":"food_dining","transactionDate":"2026-10-13T07:00:00.000Z"}' \
  http://localhost:5000/api/transactions

curl -b "$AUTH_COOKIE_JAR" http://localhost:5000/api/transactions
curl -b "$AUTH_COOKIE_JAR" http://localhost:5000/api/transactions/TRANSACTION_ID

curl -b "$AUTH_COOKIE_JAR" -X PATCH -H 'Origin: http://localhost:5173' \
  -H 'X-CSRF-Protection: 1' -H 'Content-Type: application/json' \
  -d '{"title":"Updated lunch","notes":null}' \
  http://localhost:5000/api/transactions/TRANSACTION_ID

curl -b "$AUTH_COOKIE_JAR" -X DELETE -H 'Origin: http://localhost:5173' \
  -H 'X-CSRF-Protection: 1' http://localhost:5000/api/transactions/TRANSACTION_ID
```

## Automated verification

The default `npm test --prefix backend` remains independent of MongoDB and preserves
all existing tests. HTTP contract tests inject isolated repository doubles and use
the existing signed-cookie authentication. Deterministic barriers force concurrent
requests to read the same document version before either can update it.

Real integration runs separately:

```bash
docker compose up -d --wait mongodb
npm run test:mongo --prefix backend
```

The integration runner uses only `mongodb://127.0.0.1:27017/tallynest_crud_test_<unique>`;
it never loads `.env` or accepts the development URI. It creates disposable users,
runs actual Express HTTP requests against real repositories, checks the existing
index and exact integer/date/owner persistence, tests concurrent update safety,
and drops its uniquely named database in the cleanup hook. Cleanup verifies the
name before deletion and confirms the database no longer exists afterward.

## Executed results — 2026-10-13

| Check | Result |
| --- | --- |
| Backend default suite | 148 passed: all 128 previous tests plus 20 new tests |
| Separate MongoDB HTTP integration suite | 15 passed, zero failures/skips |
| Frontend regression suite | 36 passed in 4 files |
| Backend and frontend ESLint | Both passed with zero warnings |
| Frontend Prettier check | Passed; backend has no configured Prettier check |
| Backend and frontend `npm audit --omit=dev` | Both reported 0 vulnerabilities |
| `git diff --check` | Passed |

The final integration run used `tallynest_crud_test_1791873372953_7e4315385995` and
confirmed its removal. It exercised real MongoDB persistence and owner-scoped
Express requests, exact integer boundaries, owner/date round trips, the preserved
compound index, category validation, update/delete isolation, equal-date ordering,
and version conflicts under forced concurrent updates. No development data or
`.env` files were read or changed. No dependencies were added. All changes remain
uncommitted for review.

Remaining limits are deliberate: no filtering/pagination or frontend transaction
screens, per-process in-memory rate limits, no client ETag/version preconditions,
and no protection against direct database writers bypassing validation/versioning.
