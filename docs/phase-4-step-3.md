# Phase 4, Step 3 — Shared expenses and exact splitting

Implemented on 2026-10-14. Backend-only group expense CRUD, exact split allocation
and permanent financial-history protection. No balances, debt simplification,
settlements, payments, group frontend or personal transaction synchronization.

## Financial-history protection comes first

Group has an optional immutable BSON Date `financialHistoryAt`. An unmarked group
has no shared financial history. Before the first expense insertion, the service
fully validates input, allocation, currency and registered identities, then atomically
sets the marker with these database predicates:

- Authenticated creator is a current member.
- Group ID, expected version and INR currency match.
- Payer and every selected participant are present in the same group document.
- Marker is absent; version remains below the safe limit.

That write increments group version and requires journaled-majority acknowledgement.
Expense insertion happens only after the marker is acknowledged. There is deliberately
no standalone-unsupported cross-document transaction. Once marked, members cannot
leave/be removed, groups cannot be hard deleted, and currency remains INR. Invitations
can still add new registered members; metadata edits remain permitted. The fixed owner
and no-departure rule make validated membership and owner checks stable during subsequent
expense writes. Account deletion has no application endpoint and requires a separate
historical attribution policy before it is introduced.

Group DELETE and both owner removal/member leave database writes require
`financialHistoryAt: { $exists: false }`, in addition to existing permissions/versions.
Thus deletion/removal and first locking serialize on the group document:

- Destructive write wins first: locking fails; no expense is inserted.
- Locking wins first: destructive write cannot match; history remains protected.

The first-expense lock is irreversible through application APIs. Ordinary Mongoose
changes cannot unset/overwrite its immutable field; no client field/operator is allowed
to alter it. Database administrators/raw privileged scripts can bypass application
write predicates or directly change stored data; they are outside these guarantees.
MongoDB collection validators constrain document state, not old-to-new transitions
or deletes. The database-level guarantee for destructive application operations is
the atomic marker predicate, not a claim that a validator alone enforces immutability.

**Conservative failure consequence:** interruption or expense insertion failure after
marking can leave a permanently locked group with zero visible expenses. No automatic
rollback/unlock is attempted. This false positive is intentional: unlocking after an
unknown insertion outcome risks losing genuine financial history. The public group DTO
adds `financialHistoryLocked: true` only when marked. Attempts to delete/remove/leave
return 409 `FINANCIAL_HISTORY_LOCKED`. Deleting the final expense never clears the lock.
Future archives/departure/settlement policies must explicitly replace this restriction;
there is no administrative unlock endpoint in this step.

## Expense schema and storage boundaries

GroupExpense is a **separate collection**, unrelated to personal Transaction records.

| Field | Storage / rules |
| --- | --- |
| `_id` | Stable ObjectId |
| `group` | Immutable Group ObjectId; route scope, never client body |
| `creator` | Immutable User ObjectId from authenticated account |
| `payer` | Registered current group member ObjectId |
| `title` | Trimmed string, 1–200 characters |
| `amountMinor` | Positive safe integer paise (1–9007199254740991) |
| `currency` | INR only; must match group |
| `category` | Central expense category; income-only categories rejected |
| `expenseDate` | BSON Date from canonical UTC milliseconds |
| `notes` | Optional trimmed string, max 2,000 characters |
| `split` | Method plus canonical selected participants/input weights |
| `shares` | Canonical `{ user, amountMinor }` allocation with positive integer paise |
| `createdAt`, `updatedAt` | UTC BSON Date |
| `__v` | Safe nonnegative document version; public `version` |
| `creationKey` | Internal SHA-256 digest of client idempotency UUID |
| `creationHash` | Immutable digest of normalized original creation payload |
| `deletedAt` | Optional hidden deletion receipt marker |

A payer can be a beneficiary or excluded. Selected participants need not include all
members. Stable User IDs and actual computed amounts are persisted; display names and
future roster changes never dynamically recompute historical shares. Public responses
contain stable IDs, not emails/password hashes/private user fields. Members can use the
existing authorized roster endpoint for display names.

No group expense enters personal history, dashboard totals, budget spending or recurring
records. There is no implicit copying of a shared obligation into a personal ledger.
Future integration must define explicit attribution and prevent double counting.

## Pure exact allocation

`src/utils/split.js` is independent of HTTP/MongoDB and reuses existing Zod money/ID
and shared category/currency conventions. Monetary arithmetic uses BigInt, never
floating-point rupee multiplication, approximate sums or silent rounding. Number
conversion occurs only for exact safe integer output paise. IDs are lowercased and
sorted ascending lexicographically, independent of request order.

### Equal

For total T and n selected participants: q = floor(T/n), r = T mod n. The first r
sorted IDs receive q+1 paise and the rest q. For 10000/3: 3334, 3333, 3333. A total
smaller than the selected count is rejected because at least one share would be zero.

### Exact

Each participant supplies positive safe integer amountMinor. BigInt sum must exactly
equal the total. Missing/zero/negative/fractional/unsafe shares or duplicate IDs fail.
Changing an exact-split total without matching updated exact shares is rejected.

### Percentage

Each participant supplies an integer basisPoints value 1–10000; sum must be exactly
10000. For each participant compute numerator = T × basisPoints, floor share =
numerator / 10000, fractional remainder = numerator mod 10000 using BigInt. Remaining
paise go to largest remainders first, tied by sorted ID. No participant is silently
excluded: zero final shares are rejected. Allocations preserve the input percentages
and their deterministic realized positive amounts. This is deliberate indivisible
paise allocation, not floating rounding or percentage drift.

## Database and application constraints

Creation validates the complete Mongoose document. PATCH merges editable fields with
the saved snapshot, recomputes all shares, validates the entire resulting document,
then atomically replaces editable fields and allocations under expense version CAS.
It never persists an intermediate unmatched total/share state and does not depend
solely on Mongoose update validators.

Mongoose checks field types/bounds, category, canonical UTC date, version, deterministic
canonical participant order/method fields and complete allocation equality. Zod input
is strict and normalizes IDs. Application services validate current registered payer,
participants and creator membership, currency and the permanent history marker.
MongoDB cannot enforce cross-collection foreign keys/group membership on its own;
these checks are protected by the group lock protocol and scoped application paths.

The strict GroupExpense collection validator enforces supported fields/BSON types,
positive safe integer totals/shares, valid expense categories/currency, version integer,
unique participants, matching split/share identity arrays, exact totals, method-specific
fields, exact-share equality and integer percentages summing to 10000. It sums integer
shares through Int64 to Decimal128, avoiding MongoDB double precision loss. It does not
reimplement largest-remainder ordering/equal allocation or HTTP timestamp-string parsing;
the pure utility and full-document model enforce those through validated writes. Raw
privileged writes can bypass validated application membership/allocation algorithms and
are unsupported. Collection validation rejects raw mismatched/fractional/duplicate rows.

Indexes:

```js
{ _id: 1 } // inherent MongoDB identity; lookup also includes group
{ group: 1, expenseDate: -1, _id: -1 } // deterministic bounded history
{ group: 1, creator: 1, creationKey: 1 } // unique creation-retry receipt
```

No speculative balance/filter indexes. Startup installs the extended Group validator
and new expense validator/indexes before accepting traffic; MongoDB createCollection,
collMod and index privileges are required. Existing personal schemas/indexes are unchanged.

## Authentication, authorization and API

Every endpoint requires the current authenticated registered User and group membership.
Every expense query/write includes group ID at the database level. Unrelated groups
return the existing identical missing-group 404; missing/foreign-group expense IDs
within accessible groups return identical 404 `GROUP_EXPENSE_NOT_FOUND`. There is no
unscoped expense lookup followed only by an application ownership check.

Any current member can create. Only expense creator or permanent group owner may
edit/delete. Noncreator/nonowner members receive 403 `EXPENSE_EDIT_FORBIDDEN`. Creator
and group are immutable; clients cannot rewrite who recorded an expense. Payer/selected
beneficiary changes require full registered-member validation and matching ETag. At this
stage an authorized creator/owner may correct financial attribution without approval
from beneficiaries; no funds move, no settlement exists and no revision audit ledger
is implemented. Additional approval/audit policies must precede settlement integration.
Owner authorization is checked against authoritative group state, which cannot lose its
owner after the financial lock; nonowner write predicates also require expense creator.

Mutation Origin and X-CSRF-Protection requirements remain intact; POST/PATCH require
JSON. Existing group-route rate limit (300/user/15 minutes) applies. No-store responses
and sanitized error handling reuse group API middleware. CORS now additionally allows
Idempotency-Key; existing cookie/If-Match behavior stays intact.

| Method | Path | Success / requirements |
| --- | --- | --- |
| POST | `/api/groups/:groupId/expenses` | 201 creation, 200 idempotent replay; Idempotency-Key required |
| GET | `/api/groups/:groupId/expenses` | 200, member-scoped bounded history |
| GET | `/api/groups/:groupId/expenses/:expenseId` | 200, expense and ETag |
| PATCH | `/api/groups/:groupId/expenses/:expenseId` | 200, creator/owner and If-Match |
| DELETE | `/api/groups/:groupId/expenses/:expenseId` | 200, creator/owner and If-Match |

### Request example

```json
{
  "payer": "507f1f77bcf86cd799439011",
  "title": "Shared lunch",
  "amountMinor": 10000,
  "currency": "INR",
  "category": "food_dining",
  "expenseDate": "2026-10-14T12:00:00.000Z",
  "split": {
    "method": "equal",
    "participants": ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439022"]
  }
}
```

For exact, participants are `{ user, amountMinor }`; for percentage they are
`{ user, basisPoints }`. Supported method names are `equal`, `exact`, `percentage`.
Currency defaults to INR; notes are optional. No owner/group/creator/internal ID,
version/timestamps, precomputed shares, lock marker or MongoDB operators are accepted.
Dates require a real canonical `YYYY-MM-DDTHH:mm:ss.sssZ` timestamp, with UTC reporting
semantics; date-only/offset/invalid calendar input is rejected.

Create response: `{ status: 'ok', data: { expense, replayed: false } }`.
Replay: same envelope with replayed true and HTTP 200. Read/update use
`{ status: 'ok', data: { expense } }`. Public expense fields: `id`, `groupId`,
`creatorId`, payer, title, amountMinor, currency, category, expenseDate, optional notes,
canonical split, computed shares, version, createdAt and updatedAt. Creation digests,
raw key, tombstone and Mongoose internals never appear. Single-record responses include
`ETag: "tn-<expense-id>-v<version>"`.

PATCH supports payer/title/amountMinor/currency/category/expenseDate/notes/split;
`notes: null` clears notes. Split input is replaced as a complete object, not patched
per beneficiary. Omitted fields retain existing state. Changing amount recomputes equal
or percentage allocation; exact split must be resubmitted when its total changes.
DELETE also requires current expense If-Match, then retains a hidden tombstone rather
than hard deletion. Normal reads/listing/updates exclude tombstones; expense history
and creation receipts remain available to a future explicitly authorized audit policy.
DELETE success is `{ status: 'ok', message: 'Group expense deleted' }`.

### Idempotent creation and unknown outcomes

Send a UUID in Idempotency-Key for every POST. The key is hashed and uniquely scoped
to group plus authenticated creator. Reuse with the same normalized payload (including
canonical participant order) returns the existing expense; changed payload returns 409
IDEMPOTENCY_CONFLICT. If that expense was edited, replay returns its **current** saved
state without overwriting it. If deleted, replay returns 409 EXPENSE_DELETED and never
resurrects it. Receipts have no TTL and must not be purged without another durable
idempotency record. Same UUID under a different creator/group is a distinct scope.

An initial group-lock race may return 409 before insertion; callers reconcile and
explicitly retry with the same key. Concurrent insertion after locking uses the unique
index to produce one record and safe replays. A write timeout may mean committed or
not committed: the service does not blindly retry. It returns a sanitized error, keeps
the history lock, and a deliberate retry looks up the receipt before inserting.
The initial group marker write and expense insertion are not claimed to be a
cross-document atomic transaction; only the permanent protection plus unique receipt
makes this sequence recoverable on standalone MongoDB.

### Listing and versions

GET collection accepts only `limit` (default 20, maximum 100) and `after`. It fetches
limit+1, sorted `expenseDate DESC, _id DESC`. Response:

```json
{
  "status": "ok",
  "data": { "expenses": [] },
  "pagination": { "limit": 20, "hasMore": false, "nextAfter": null }
}
```

The nextAfter value is base64url-encoded strict JSON `{ v: 1, group, expenseDate, id }`.
Send it as after. Canonical encoding, ID/date/version shape and matching group are
validated. This is a simple group-bound keyset position, **not** an encrypted/signed
capability; changing a valid position can move within the caller's authorized history
but cannot bypass membership/group scope. No arbitrary filters/projections/operators
are accepted. Inserts/deletes/date updates between pages can cause omissions/revisits;
there is no snapshot traversal. Duplicate sort values retain ID ordering. Financial
values stay integer paise.

PATCH/DELETE missing precondition returns 428, invalid syntax/resource 400, an already
stale version 412, and an atomic race after validation 409 (or 404 if now deleted).
Version is compared and incremented in the same expense write. Clients must reload and
review; there are no silent overwriting retries.

Other consistent error codes include INVALID_GROUP_EXPENSE, INVALID_SPLIT,
INVALID_MEMBERSHIP, INVALID_GROUP_ID/INVALID_EXPENSE_ID, INVALID_QUERY/INVALID_CURSOR,
IDEMPOTENCY_KEY_REQUIRED, IDEMPOTENCY_CONFLICT, EXPENSE_DELETED,
EXPENSE_EDIT_FORBIDDEN, GROUP_EXPENSE_NOT_FOUND, GROUP_EXPENSE_CONFLICT,
GROUP_CONFLICT, FINANCIAL_HISTORY_LOCKED, AUTH_REQUIRED, CSRF_REJECTED,
JSON_REQUIRED, RATE_LIMITED and sanitized INTERNAL_ERROR.

## Historical identity and future decisions

Memberships are permanently retained for marked groups until a dedicated financial
policy exists. Expense attribution is stored as stable user IDs and computed paise,
not current roster/name-derived calculations. Future departure/account deletion must
preserve historical payer/beneficiary identity, creditor/debtor rights and audit access.
Future group archival, settlement records, correction approvals and balance calculations
must explicitly define how tombstoned expenses affect obligations and how revisions
are audited. Nothing here implements debts, balances or settled states. There is no
financial cascade or automatic personal transaction copying.

## Files and verification

New backend files:

- `src/validators/group-expense.validator.js` — strict input/patch/keyset/idempotency schemas.
- `src/utils/split.js` — pure BigInt allocation and canonical ordering.
- `src/models/group-expense.model.js` — separate financial schema/database validator.
- `src/repositories/group-expense.repository.js` — group-scoped validated CAS and receipts.
- `src/services/group-expense.service.js`, `src/controllers/group-expense.controller.js`.
- `tests/group-expense.test.js`, `tests/helpers/group-expense-api.js`,
  `tests/helpers/group-expense-repository.js`, `integration/group-expenses.mongo.js`.

Modified Group model/validator, group and membership repositories/services/authorization,
group routing, app wiring/CORS, server initialization, package test:mongo and existing
isolated test doubles/assertions. README and previous Phase 4 specs now point to the
current history-protection policy. No frontend, personal schema, monetary format,
dependencies or environment secrets changed.

Executed on 2026-10-14 using Node.js 24 and real local standalone MongoDB 8.0:

| Check | Result |
| --- | --- |
| `npm test --prefix backend` | 285 passed, zero failed/skipped; 16 new expense/split tests |
| `npm run test:mongo --prefix backend` | 127 passed, zero failed/skipped; 17 new expense tests |
| `npm test --prefix frontend` | 165 passed across 15 files |
| Both package ESLint commands | Passed, zero warnings |
| `npm run format:check --prefix frontend` | Passed; no backend Prettier command configured |
| Both production `npm audit --omit=dev` commands | Zero vulnerabilities |
| `git diff --check` | Passed |

Docker Compose confirmed healthy MongoDB. Live tests used existing authenticated
registered fixture accounts, including selected-member exclusion and payer choices.
Critical tests executed 8 actual first-creation/deletion races and 8 first-creation/removal
races, plus immutable model marker checks, direct guarded repository writes, concurrent
CAS updates, concurrent idempotent creates, before/after-insert injected failures with
fresh service recovery, exact maximum-safe integer allocations, raw BSON constraint
rejection, actual indexes, pagination and deletion receipts. Personal Transaction,
Budget and RecurringSchedule records retained unchanged stored values through group expense
CRUD; dashboard/budget API responses were also unchanged.

All integration databases are disposable and dropped/checked afterward. The final
expense database was `tallynest_group_expense_test_1791983752735_69add7177e92`. A separate cleanup
inspection confirmed all 18 recorded databases from the full/focused logs were absent,
and no group-expense test databases remained. No development
financial data was accessed or modified. Actual OS kill, power loss or Atlas failover
was not simulated. No frontend browser/build result is claimed for this backend-only task.
Changes remain uncommitted for review.

Known limitations: permanent false-positive locks after failed insertion, no unlock or
archive flow, hidden deleted records retained indefinitely, no immutable revision audit
ledger/beneficiary approvals, simple nonsnapshot keyset traversal, and shared expense
collection validators cannot enforce cross-collection membership references. Existing
limits and process-local group rate limiter remain. Dedicated balances/settlements,
departure rights and historical account-deletion handling are future work.
