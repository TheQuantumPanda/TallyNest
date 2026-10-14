# Phase 4, Step 1 — Groups and membership backend

> Current policy update (Phase 4, Step 3): groups permanently marked with financial
> history cannot be hard deleted, and their members cannot leave or be removed.
> These restrictions are enforced in database write predicates before the first
> shared expense insertion. Deleting every visible expense never clears the lock.
> See [the shared expense specification](phase-4-step-3.md) for concurrency, conservative
> failed-creation locks and updated deletion behavior. Earlier policies below describe
> this document's implementation snapshot and apply only to unmarked groups.

Implemented on 2026-10-13. This foundation adds authenticated group metadata CRUD
and initial creator membership only. It adds no invitations, joining, member removal,
shared expenses, splits, balances, settlements, payments or frontend pages. Personal
financial records and existing contracts are unchanged.

## Group and membership schema

| Field | Storage | Rules |
| --- | --- | --- |
| `_id` | ObjectId | Stable MongoDB group identity |
| `name` | String | Required, trimmed, 1–100 characters after trimming |
| `description` | String | Optional, trimmed, at most 2,000 characters |
| `currency` | String | INR only; default INR |
| `creator` | ObjectId, User reference | Required, immutable through the model; authenticated creator |
| `members` | Embedded membership array | 1–100 distinct registered user references; exactly one creator-owner |
| `createdAt`, `updatedAt` | BSON Date | Mongoose-managed UTC timestamps |
| `__v` | Safe nonnegative integer | Internal version; public field is `version` |

Each embedded membership contains `user` (existing User ObjectId reference),
`role` (`owner` or `member`), and required `createdAt` (BSON Date). There is no
separate membership identity or separate user system. The containing group provides
the group reference. Membership pairs `(group._id, members.user)` must be unique.
Names are not unique: separate groups may have the same name.

### Embedded membership decision

Embedded membership makes group creation and its initial owner one atomic document
insert. It avoids a separate group/membership commit gap, cleanup protocol or
replica-set transaction requirement on standalone Docker MongoDB. There is no time
at which an acknowledged new group lacks its owner membership.

An embedded array is practical for small expense groups and efficient membership
queries, but has a documented 100-member bound and single-document write contention.
Future invitations may become members via a carefully validated atomic operation;
that operation does not exist in this step. Large-group support or substantial
membership history could justify migration to a dedicated collection later. Such
a migration requires its own visibility/idempotency/consistency protocol.

### Initial invariant and failures

The repository builds the complete group with exactly one membership for the
authenticated creator, role owner, before validation or persistence. It performs
one journaled-majority write using the existing durable-write utility. A failure
before insertion leaves no group. A failure after MongoDB commits but before the
caller receives an acknowledgement leaves a complete valid group with its owner.
No orphan group or orphan separate membership can exist from this write path.

Creation does not implement an idempotency key. If a response is lost, clients should
list groups before deliberately retrying; retries may create a second independent
group, each with its own valid owner. The server does not silently retry creates.
Fault-injected real MongoDB tests covered before-write and after-commit failures.
Actual power loss, process termination and Atlas failover were not simulated.

## Database constraints and indexes

Mongoose validates membership cardinality, unique users, exactly one owner matching
creator, valid roles, references, timestamps, metadata and version boundaries.
Zod rejects request/operator/protected-field input before any database mutation.

A strict MongoDB collection validator also enforces:

- BSON types, required fields, INR, name/description bounds and supported fields.
- Membership count 1–100 and required user/role/timestamp fields.
- No duplicate member user IDs, even when duplicate rows have different dates/roles.
- Exactly one owner, corresponding to creator.
- Safe nonnegative integer versions.

The validator uses `$jsonSchema` and `$expr` array set/cardinality rules. A unique
multikey index cannot enforce uniqueness inside one document's array, so it is
intentionally **not** used as a misleading uniqueness guarantee. Raw MongoDB writes
without bypassDocumentValidation are also rejected when these invariants fail.
Database administrators can bypass validation; that is outside application authorization.
MongoDB references do not provide foreign keys. This step accepts no membership
IDs from clients; creation uses an existing authenticated User. Future membership
operations must verify registered users and address account deletion explicitly.

Indexes:

```js
{ _id: 1 } // MongoDB's inherent unique group identity
{ 'members.user': 1, _id: -1 } // member-scoped deterministic listing
```

Single-record writes use `_id` plus authoritative owner/member predicates; extra
creator/role/name indexes are unnecessary at this stage. Startup installs the
collection validator and awaits group index initialization before accepting traffic.
`ensureGroupIndexes` is repeatable; it creates the collection if missing and applies
collMod to enforce strict/error validation. The MongoDB application/deployment identity
must be able to create the collection, apply collMod and initialize indexes. Startup
fails closed on installation failures. Validator installation does not repair or
retroactively audit externally imported existing documents; a future migration must
validate such data explicitly. No development database was used during verification.

## Roles, authorization and privacy

| Operation | Owner | Member | Unrelated authenticated user |
| --- | --- | --- | --- |
| Create own group | Yes | Yes | Yes; becomes its owner |
| List/read this group | Yes | Yes | Identical 404 for inaccessible/missing ID |
| Edit metadata | Yes, matching If-Match | 403 | Identical 404 |
| Delete group | Yes | 403 | Identical 404 |

Reusable `requireGroupMember`, `requireGroupOwner` and `membershipFor` helpers live
in the service layer. They operate on an authoritative member-scoped repository read.
Every HTTP read/list query includes the authenticated member user at the database
level. Owner updates/deletes also include creator and `$elemMatch` user/owner-role
predicates in the database write, so a stale application ownership check cannot
bypass changed database permissions. PATCH additionally compares the version.
There is no unrestricted lookup/search or fetch-all-then-filter authorization path.

Members already know the group exists, so denied owner operations return 403
`GROUP_OWNER_REQUIRED`. Unrelated users and missing groups share 404
`GROUP_NOT_FOUND` before version precondition evaluation for valid requests. Invalid
input can independently return 400 without revealing group existence.

Public responses expose only group metadata, ID/version/timestamps and the **caller's**
`membership: { role, createdAt }`. Creator ID, the complete membership roster, other
user IDs, credentials and model internals are not exposed or populated. No membership
or invitation HTTP endpoints exist. Member-role integration tests seed memberships
only as trusted disposable fixtures.

## API contract

All routes require the existing JWT HTTP-only cookie and live authenticated user
lookup. Mutations require exact configured Origin and `X-CSRF-Protection: 1`.
POST/PATCH require JSON. Existing credentialed CORS permits If-Match and exposes ETag.
Responses use `Cache-Control: no-store`; unexpected errors are sanitized in every
environment. Basic per-user limiting is 300 requests per 15 minutes, using existing
process-local rate-limit infrastructure; counters reset on restart and are not shared
across instances.

| Method | Endpoint | Success |
| --- | --- | --- |
| POST | `/api/groups` | 201, created group and ETag |
| GET | `/api/groups` | 200, caller's groups and pagination |
| GET | `/api/groups/:id` | 200, group and ETag; membership required |
| PATCH | `/api/groups/:id` | 200, metadata and new ETag; owner + If-Match required |
| DELETE | `/api/groups/:id` | 200, `Group deleted`; owner required |

Create body:

```json
{
  "name": "Household",
  "description": "Shared space",
  "currency": "INR"
}
```

Description/currency may be omitted. All fields are strict: creator, owner, members,
member IDs, roles, `_id`, versions, timestamps, balance fields and MongoDB operators
are rejected. PATCH supports only name, description and currency; `description: null`
clears it, an empty string is allowed, and an empty patch is rejected. Currency cannot
change to anything other than INR. Updating metadata never changes creator/membership.

Create/read/update envelope example:

```json
{
  "status": "ok",
  "data": {
    "group": {
      "id": "507f1f77bcf86cd799439033",
      "name": "Household",
      "description": "Shared space",
      "currency": "INR",
      "version": 0,
      "membership": { "role": "owner", "createdAt": "2026-10-13T00:00:00.000Z" },
      "createdAt": "2026-10-13T00:00:00.000Z",
      "updatedAt": "2026-10-13T00:00:00.000Z"
    }
  }
}
```

Example header: `ETag: "tn-507f1f77bcf86cd799439033-v0"`.

Listing accepts only `limit` (default 20, integer 1–100) and `after` (ObjectId).
Order is `_id DESC`; the query fetches limit+1. Following nextAfter through after
retains authenticated member scope. No search, member/owner or arbitrary query
operators are accepted. Pages reflect current state, not a point-in-time snapshot;
new/deleted groups or future membership changes can affect traversal.

```json
{
  "status": "ok",
  "data": { "groups": [] },
  "pagination": { "limit": 20, "hasMore": false, "nextAfter": null }
}
```

DELETE success: `{ "status": "ok", "message": "Group deleted" }`.

### Concurrency and errors

PATCH requires the exact quoted resource ETag via If-Match. The service validates
metadata, checks member/owner permissions against current state, verifies the client
version, and performs an atomic owner/ID/version update with `$inc: { __v: 1 }`.
There are no automatic overwriting retries.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | INVALID_GROUP / INVALID_GROUP_ID / INVALID_QUERY / INVALID_VERSION | Invalid input, ID, query or conditional syntax/resource ID |
| 401 | AUTH_REQUIRED | Missing/expired/invalid session |
| 403 | GROUP_OWNER_REQUIRED / CSRF_REJECTED | Known member lacks owner rights, or mutation lacks valid origin/header |
| 404 | GROUP_NOT_FOUND | Missing or inaccessible group |
| 428 | PRECONDITION_REQUIRED | Authorized owner update omitted If-Match |
| 412 | VERSION_MISMATCH | Client version is already stale |
| 409 | GROUP_CONFLICT | Race after validated read, or safe version exhausted |
| 415 | JSON_REQUIRED | POST/PATCH did not use JSON |
| 429 | RATE_LIMITED | Basic request limit exceeded |
| 500 | INTERNAL_ERROR | Sanitized unexpected failure |

Errors use `{ status: 'error', code, message }`. On an atomic-write race the service
rechecks member/owner scope: deletion/lost membership becomes 404 and lost owner rights
becomes 403; an accessible unchanged authorization state gets 409. DELETE follows
existing foundation deletion conventions without If-Match; the final write still
requires database owner predicates.

## Deletion and future financial boundaries

For this foundation, owner DELETE hard-deletes the group and its embedded memberships
atomically. It never deletes User accounts, personal transactions, recurring schedules
or budgets. There are no group financial records to cascade. This deletion policy
**must be revisited before shared expenses or settlements are introduced**: do not
attach financial history and silently continue hard deletion or add an unchecked
cascade.

Before invitations/member removal/shared expenses are added, explicitly decide:

- Invitation acceptance, registered identity lookup, duplicate membership races and
  the 100-member bound; use atomic predicates/full invariant checks and versioning.
- Whether members with outstanding obligations can leave or be removed, and how
  creditor/debtor rights and historical beneficiary/payer identity remain accessible.
- Owner succession/transfer and final-owner protections; creator is immutable here.
- Archived groups versus hard deletion, preserving settled/unsettled financial history
  and audit records independently of current memberships.
- Authorization changes during future financial writes and historical access policy.
- Multiple beneficiaries, exact minor-unit splitting, currency consistency and debt
  simplification; no balance/split/settlement fields are added speculatively now.

Future group expenses must have explicit storage/query boundaries and must never be
implicitly included in current personal transaction/dashboard/budget totals. No group
operations import or convert personal records.

## Files and architecture

New backend files:

- `src/models/group.model.js` — group and embedded membership schemas/database validator.
- `src/validators/group.validator.js` — reusable strict Zod input/query schemas.
- `src/repositories/group.repository.js` — scoped writes/reads, atomic creation, startup constraints.
- `src/services/group.service.js` — metadata rules, pagination/version orchestration.
- `src/services/group-authorization.js` — reusable member/owner helpers.
- `src/controllers/group.controller.js` — HTTP envelopes and ETags.
- `src/routes/group.routes.js` — auth/CSRF/rate-limit/controller wiring.
- `tests/group.test.js`, `tests/helpers/group-api.js`, `tests/helpers/group-repository.js`.
- `integration/groups.mongo.js`.

Modified `backend/app.js` injects/wires the service; `server.js` initializes constraints;
`src/middleware/errorHandler.js` sanitizes group errors; package test:mongo includes
new integration tests. README and this specification document contracts. No new
packages, environment settings, frontend files or personal financial schemas changed.

## Verification

Executed on 2026-10-13 with Node.js 24 and local Docker MongoDB 8.0:

| Check | Result |
| --- | --- |
| `npm test --prefix backend` | 251 passed, 0 failed/skipped; 14 new group tests |
| `npm run test:mongo --prefix backend` | 90 passed, 0 failed/skipped; 15 new group tests |
| `npm test --prefix frontend` | 165 passed across 15 files |
| Both package ESLint commands | Passed, zero warnings |
| `npm run format:check --prefix frontend` | Passed; no backend Prettier command configured |
| Both production `npm audit --omit=dev` commands | Zero vulnerabilities |
| `git diff --check` | Passed |

`docker compose up -d --wait mongodb` confirmed healthy local MongoDB. Integration
runs used uniquely named disposable databases and dropped them afterward. A separate
final database-name inspection confirmed all eight databases from the two focused
runs and full integration run were absent. The final
group run used `tallynest_group_test_1791899717715_00d511aac5e6`. No development or production
data was used. Live tests exercised actual HTTP auth/group CRUD, collection validation,
index installation, owner/member permissions, ObjectId/date round-trip, concurrent
creates/updates, failed creation outcomes and unchanged personal finance records.

No frontend walkthrough/build was needed for this backend-only stage, and no new
browser verification is claimed. There is no invitation/joining capability yet, so
all real member-role tests use trusted fixtures. Creation acknowledgement failure
may require deliberate client reconciliation; cross-process failure/failover was not
simulated. Standalone MongoDB support was executed; Atlas-specific permissions and
failover remain unverified. Changes remain uncommitted for review.
