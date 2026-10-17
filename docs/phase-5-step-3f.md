# Phase 5, Step 3F — staged settlement-cycle HTTP API

## Scope and activation boundary

This is a coordinated **version-2 HTTP contract**, available only from the disposable integration composition root `backend/integration/helpers/staged-cycle-app.js`. Neither `backend/app.js` nor `backend/server.js` imports or registers the staged router. There is no environment switch, request header, query parameter, ordinary group-creation option, migration override, or public activation URL. The standard application's cycle URLs remain 404; its financial services continue to reject version-2 groups with `CYCLE_PROTOCOL_INACTIVE`.

`createDisposableCycleApp` requires `nodeEnv: test` and a connected database whose name matches `tallynest_cycle_http_test_<13 digits>_<12 lowercase hex characters>`. It rejects an offline-migration repository adapter. Fixtures explicitly construct the existing internal enabled coordinators; no ordinary user can set the protocol version. Tests create synthetic version-2 groups directly. They do not release rehearsal holds, run real-data migration, or start a production server on migrated data.

Legacy groups keep their existing financial services, DTOs, group-wide balance semantics, permanent history marker, and global `settlementStartedAt` expense freeze in the ordinary application. The staged financial router deliberately accepts **only version 2**, with no fallback to a legacy financial writer. Existing authentication, invitations, group metadata, and roster routes are composed from the actual application in the fixture server. The production frontend is unchanged and must not consume this new envelope until a coordinated rollout.

## Findings against the internal implementation

Step 3D returns complete transition journals and operations, not HTTP-safe DTOs. They contain hashes, fixed intents, and recovery payloads which must remain private. Its lifecycle replay fingerprint includes the original expected versions and epoch; an HTTP adapter must preserve those values rather than replacing them with freshly read versions on a retry. Step 3C financial updates accept a complete validated expense, not an HTTP PATCH. The adapter merges the patch with the fetched record, validates the full input, then passes the original document version to the coordinator's atomic operation.

The existing invitation acceptance predicate already admits version-2 members only at a closed-cycle boundary with no reservation. It is preserved. Step 3E rehearsal databases intentionally remain held, with stricter migration validators. This milestone does not add a release mechanism or pretend those held databases are ready for HTTP activation.

## Modules

```text
backend/
  src/staged/
    contract.js                  # strict input schemas, resource ETags, public cycle/head DTOs
    readiness.js                 # read-only metadata and association inspection
    history.repository.js        # bounded database keyset reads and signed scoped cursors
    cycle-http.service.js        # HTTP-to-coordinator orchestration and full PATCH validation
    cycle-http.controller.js     # HTTP envelopes, status codes and response headers
    cycle-http.routes.js         # authentication, rate limit, CSRF and endpoint composition
  integration/
    helpers/staged-cycle-app.js   # disposable-only composition root, absent from production imports
    cycle-http.mongo.js          # real authenticated Express/MongoDB scenarios
  tests/cycle-http.test.js        # pure contract and construction-boundary checks
```

`backend/package.json` adds the HTTP MongoDB suite to the existing integration gate. README links this specification. No models, collection validators, financial coordinators, authentication rules, frontend files, or dependency versions are changed.

## Common version-2 response contract

All staged financial/cycle responses have `Cache-Control: no-store`. Authentication uses the existing `sfm_access` HttpOnly cookie in the **test-only** server. Mutations require the exact configured `Origin`, `X-CSRF-Protection: 1`, and JSON where a body is used. Each authenticated user has the existing 300 requests per 15 minutes limit on the staged group router. No tokens or financial payloads are logged.

Success envelope:

```json
{
  "status": "ok",
  "apiVersion": 2,
  "data": {
    "group": {
      "id": "507f1f77bcf86cd799439011",
      "version": 4,
      "etag": "\"tn-507f1f77bcf86cd799439011-v4\"",
      "currentCycleId": "507f1f77bcf86cd799439012",
      "currentCycleState": "open",
      "epoch": 1,
      "busy": false
    }
  }
}
```

Every success includes this authoritative group head and `X-Group-ETag`. A single resource additionally produces `ETag: "tn-<resourceId>-v<version>"`. A cycle-less group has null current-cycle identity/state and epoch zero. `busy` means a durable operation remains; it is not permission to unlock anything. Cycle history/detail rejects an active reservation with `FINANCIAL_BUSY`, so a partially completed cycle transition is not presented as a committed lifecycle state. Recovery returns the latest group head and, when present, the authoritative current cycle and its ETag after reconciliation. Separate group and resource reads are not a cross-document snapshot; conditional writes and coordinator CAS remain authoritative.

`cycle` has exactly: `id`, `groupId`, `sequence`, optional `previousCycleId`, `currency: INR`, `state: open|frozen|closed`, sorted `memberIds`, `openedAt`, optional `frozenAt`/`closedAt`, `version`, `etag`. Timestamps are canonical UTC ISO strings. No maintenance identity, transition intent/hash, operation payload, migration checkpoint or private user fields appear.

Existing errors retain `{status:"error",message,code}` and sanitized handling. Examples: 400 invalid request/UUID/resource ETag, 401 authentication required, 403 owner/recipient/CSRF rejection, non-disclosing 404 missing/foreign resources, 428 missing precondition, 412 stale version, 409 financial busy/state/idempotency conflict, 422 corrupt or unsafe financial source, 429 rate limit, 503 held maintenance/schema/index readiness. Unrecognized database errors remain sanitized 500; they are never converted into a misleading success.

## Lifecycle endpoints

All paths below are relative to `/api/groups/:groupId` and exist **only on the staged fixture server**.

| Method/path                    | Contract                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/cycles`                  | Current authenticated members may read bounded cycle history, sequence descending then ID descending. Query: `limit` (default 20, max 100), optional signed `after`.                                    |
| GET `/cycles/:cycleId`         | Member-authorized, group-scoped cycle detail, resource ETag and group head. No query fields. Foreign-cycle IDs return 404.                                                                              |
| POST `/cycles`                 | Owner only. Opens the first empty cycle, or explicitly opens the next cycle after a closed predecessor. Never closes, migrates or bootstraps a legacy group. Fresh 201, identical completed replay 200. |
| POST `/cycles/:cycleId/freeze` | Owner-only irreversible open → frozen, 200, including identical replay.                                                                                                                                 |
| POST `/cycles/:cycleId/close`  | Owner-only frozen → closed, 200, including identical replay. Recomputes exact balances under the existing reservation and requires zero obligations, no pending settlements and valid source data.      |

All lifecycle mutations require a UUID `Idempotency-Key` and resource-specific preconditions:

- **First open:** body `{}`, `If-Match` is the group ETag. There is no implicit current-cycle selection. Repeating `{}` always retries first-open intent, even after a later cycle exists.
- **Next open:** body `{ "previousCycleId": "<closed-cycle-id>", "epoch": 1 }`. `If-Match` is the group ETag; `If-Cycle-Match` is that predecessor's cycle ETag. Missing epoch is invalid. The sequence, next epoch, new ObjectId and member snapshot are allocated by the internal lifecycle coordinator.
- **Freeze/close:** body `{ "epoch": 1 }`. `If-Match` is the addressed cycle's ETag; `If-Group-Match` is the group's ETag. Extra fields, body versions, owner overrides and operators are rejected.

Clients obtain preconditions from the cycle detail/group head, not by constructing a version override. Every supplied version is parsed against its resource identity, then compared by the existing lifecycle service and atomic reservation/CAS predicates. Epoch is also untrusted and fenced by the group reservation. Missing required headers return 428; malformed or cross-resource ETags return 400; stale versions return 412 where checked before acquisition; contention/state changes may return 409.

A mutation returns `data.cycle`, `data.group`, `data.replayed` and `data.transition: {outcome,completedAt}`. `outcome` is the original committed transition outcome; the returned cycle/group are current authoritative records and may have progressed after that transition. The immutable journal remains private. Identical replay retains the original UUID, body, group ETag and cycle ETag, even if newer cycles exist. Changed normalized intent with that UUID returns `IDEMPOTENCY_CONFLICT`. Do not automatically substitute current versions or submit another transition after a lost response.

The fixture CORS policy explicitly allows `If-Group-Match` and `If-Cycle-Match`, exposes `X-Group-ETag` plus `ETag`, and otherwise retains the exact configured origin and credential policy. Production CORS is not changed.

## Cycle-scoped financial contracts

| Method/path                                            | Contract                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/expenses`                                        | Established shared expense history order: expense date DESC, ID DESC. Optional `cycleId`; omission is explicitly group-wide history. `limit`/`after` are bounded. Tombstones are excluded.                                                      |
| GET `/expenses/:expenseId`                             | Group-scoped detail. Immutable record cycle is returned; no query fields.                                                                                                                                                                       |
| POST `/expenses`                                       | Existing expense input plus explicit `cycleId` and UUID `Idempotency-Key`. Member creation in the current open cycle through Step 3C. Fresh 201, replay 200.                                                                                    |
| PATCH `/expenses/:expenseId`                           | Existing strict patch fields only. Current expense `If-Match`. Full merged input and exact shares are validated; notes may be cleared with null. No cycle reassignment. Creator or authoritative owner only.                                    |
| DELETE `/expenses/:expenseId`                          | Current expense `If-Match`, creator/owner only. Existing durable tombstone semantics, response `data.deleted: true`. No history unlock.                                                                                                         |
| GET `/settlements`                                     | Group-wide historical list, or explicit `cycleId`. ID DESC with bounded `limit`/signed `after`.                                                                                                                                                 |
| GET `/settlements/:settlementId`                       | Group-scoped detail, record cycle and settlement ETag. No query fields.                                                                                                                                                                         |
| POST `/settlements`                                    | `{cycleId,recipient,amountMinor,currency?}`, UUID `Idempotency-Key`; authenticated sender cannot be overridden. Capacity is validated within the cycle. A first valid proposal freezes only that cycle under the existing recoverable protocol. |
| POST `/settlements/:settlementId/confirm` or `/reject` | Body `{}` and settlement `If-Match`; intended recipient only. Atomic pending → terminal decision. No repeated automatic confirmation.                                                                                                           |
| GET `/balances?cycleId=<id>`                           | Explicit required cycle; returns exact per-cycle balances, separate pending reservations and deterministic debt suggestions. No implicit current-cycle default.                                                                                 |
| POST `/financial-recovery`                             | Body `{}`. One explicit recovery invocation for the original reservation. No forced unlock or new target allocation.                                                                                                                            |

Expense DTO: all established public expense fields (`id,groupId,creatorId,payer,title,amountMinor,currency,category,expenseDate,notes?,split,shares,version,createdAt,updatedAt`) plus immutable `cycleId`. Settlement DTO: established public fields (`id,groupId,sender,recipient,amountMinor,currency,status,version,createdAt,confirmedAt?,rejectedAt?,decisionBy?`) plus immutable `cycleId`. Single responses place these under `data.expense` or `data.settlement`, with the group head; creation also includes `replayed`.

Lists return `data.expenses`, `data.settlements` or `data.cycles`, the group head, and top-level `pagination: {limit,hasMore,nextAfter}`. Queries are strict: no arbitrary filters, sort objects, projections or MongoDB operators. Fetches use `limit + 1`; no full financial history is loaded to paginate. Cursor HMAC-SHA256 is verified in constant time. Its signed scope binds contract version, list kind, authenticated user, group, cycle filter (including group-wide null), and page size. Expense positions include UTC date and ID; cycles use sequence and ID; settlements use ID. Invalid, tampered or differently scoped cursors return `INVALID_CURSOR`. Cursors have no expiry in this staged contract. History changes between pages are not a snapshot: edits/insertions/deletions may affect traversal. Filters/page size changes require starting again.

The balances object has `groupId,cycleId,currency,netTotalMinor:0,members,suggestions`. Each member has `user,paidMinor,assignedMinor,confirmedSentMinor,confirmedReceivedMinor,netMinor,pendingSentMinor,pendingReceivedMinor`. Suggestions have `sender,recipient,amountMinor,currency`. All monetary JSON values are safe integers in paise; signs are retained. Existing MongoDB group+cycle aggregation, BigInt checks, source validation, zero-sum reconciliation and pending capacity remain authoritative. Closed historical cycles never incorporate later cycles. No expense/settlement creates a personal financial record or executes a bank transfer.

### Creation receipts before cycle selection

New writes must supply `cycleId`, including Cycle 1. Missing selection returns 409 `CYCLE_SELECTION_REQUIRED`; it never selects a newly open Cycle 2. Before any active-cycle decision, the adapter looks up the group-wide actor/key receipt. An omitted cycle is recognized only for a receipt whose original Cycle 1 carries the verified migration provenance pair introduced in Step 3E. The existing coordinator then validates the exact original normalized legacy hash. A merely similar payload or arbitrary unproven cycle is insufficient.

Explicit original-cycle replay after another cycle opens returns the original current resource, even if subsequently edited. A tombstone returns `EXPENSE_DELETED`; it never resurrects. A reused key with changed normalized payload or another cycle conflicts. In-flight concurrent requests may receive `FINANCIAL_BUSY`; an explicit identical retry reconciles the existing receipt. No title/amount/date similarity deduplication is introduced. Receipt uniqueness remains group-wide, not per cycle.

## Authorization and membership

| Action                        | Authorized actor                                                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cycle/financial history reads | Current authenticated group member; all lookups additionally group-scoped.                                                                                                                           |
| Per-cycle balances            | Existing coordinator additionally requires membership in that immutable cycle snapshot. A member admitted later cannot obtain this historical balance through the current internal balance contract. |
| Open/freeze/close             | Authoritative creator-owner membership.                                                                                                                                                              |
| Expense create                | Current member in the selected cycle snapshot. Payer/beneficiaries must also be current registered members in the snapshot.                                                                          |
| Expense edit/delete           | Expense creator or authoritative group owner; immutable cycle must be current and open.                                                                                                              |
| Settlement propose            | Authenticated sender, current/snapshot membership, different eligible recipient, exact capacity.                                                                                                     |
| Settlement confirm/reject     | Intended recipient, current/snapshot membership, current frozen cycle and pending document version.                                                                                                  |
| Financial recovery            | Existing actor or owner for a financial write; owner only for a lifecycle transition.                                                                                                                |

Existing invitation acceptance remains atomic and admits a new member only when the current version-2 cycle is **closed**, no financial reservation exists, the invite is valid, and the member limit permits it. Open/frozen acceptance fails without consuming a use. The next explicit open snapshots the enlarged roster; earlier member snapshots and historical allocations remain unchanged. Departure/removal remain permanently blocked by financial history. Owner succession is not provided. Existing roster DTOs expose names, roles and dates, not private email addresses.

## Readiness and maintenance

`assertCycleHttpReadiness` is read-only and verifies all five current group/expense/settlement/cycle/transition collection definitions, strict/error-action validators and every declared index including group-wide receipt uniqueness, cycle history, active-slot and journal uniqueness. Unknown definitions, missing indexes or unexpected financial TTL indexes fail closed; the helper never repairs them. It rejects both a database held migration run and any group migration marker. Construction rejects unresolved version-2 reservations. A fresh server with such a reservation requires controlled internal recovery before it can pass activation inspection; this test factory does not provide a recovery-only startup mode. Per-request probes allow only the existing recovery dispatcher to resolve operations; ordinary financial/coordinator predicates still enforce busy/state restrictions.

`assertCycleGroupConsistency` is an additional pre-construction inspection: it rejects unexpected protocol versions, unresolved reservations, inconsistent current pointer/state/currency/epoch, missing cycle associations and cross-group orphan associations. It streams groups and performs database-scoped association checks. It does not run during every concurrent mutation, because separate reads could observe a legitimate in-flight transition. These checks are readiness evidence, not a replacement for group-slot CAS or proof against a privileged raw writer.

The staged fixture conservatively probes schema/index/maintenance metadata on each request, with no readiness cache. This is intentionally expensive and requires a separate performance/least-privilege activation review. Runtime inspection needs collection metadata/index reads and maintenance-marker reads in addition to approved CRUD. Setup/migration needs separate create/index/`collMod` privileges. No runtime repair privilege is justified by this helper. Stricter post-migration validator definitions are deliberately rejected until a separately reviewed maintenance-release/activation contract exists.

A database-wide maintenance marker cannot atomically fence another collection's write, nor fence an old binary that ignores it. Existing per-group `cycleMigration` absence predicates remain enforced in actual writes. Operational shutdown of all old writers is still mandatory for migration; this milestone supplies no competing release or override path.

## Recovery and concurrency

The HTTP layer uses the Step 3C/3D checking → applying coordinator without changing it. Targets, cycle/epoch, actor, source versions and payloads remain fixed. Applying work is never expired or discarded. Freeze recovery reconciles cycle state and group mirror; financial recovery proves the original target/receipt before release. Responses expose `recovered`, the authoritative group head and the current public cycle/ETag when present, not the raw recovered financial row or journal. An unresolved/corrupt operation stays blocked with a sanitized error; clients must not convert it into a second intent.

Independent-connection HTTP tests exercise a freeze interrupted after its cycle write, recovery by a second server, close and next open, then resumption of the delayed original worker. The original completion cannot mutate the newly open cycle. Other HTTP races cover first open, expense creation versus freeze, confirmation versus closure, and competing next opens. Existing lower-level suites retain broader fixed-target, stale-worker, fault-boundary, migration reconciliation and process-kill coverage.

## Verification

Targeted commands from the repository root:

```bash
node --test backend/tests/cycle-http.test.js backend/integration/cycle-http.mongo.js
npm run verify:clean
npm exec --prefix frontend -- prettier --config frontend/.prettierrc.json --check docs/phase-5-step-3f.md
git diff --check
```

The integration suite uses actual Express listeners, three registered disposable accounts, real login-issued cookies, and standalone MongoDB. Separate workers use independent MongoDB connections and separate HTTP servers. Each suite creates and verifies removal of its uniquely named database. It does not touch development financial data. The targeted checks cover lifecycle/financial HTTP contracts, exact shares, ownership, Origin/CSRF, ETags and replay, frozen/closed history, scoped cursors, maintenance/schema/index drift, migration-provenance replay, membership boundary, concurrency and injected interruption recovery.

Final clean-gate results on Node.js 24.21.0 and standalone MongoDB 8.0.32:

| Check                          | Executed result                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify:clean`         | Passed, exit 0, including reproducible package installation.                                                                                 |
| Backend unit/HTTP tests        | 314 passed, zero failures/skips; includes four new pure contract tests.                                                                      |
| Frontend regression tests      | 248 passed across 20 files. No frontend changes.                                                                                             |
| Real MongoDB integration       | 238 passed, zero failures/skips; includes 22 new staged HTTP cases and all existing Step 3C/3D/3E, legacy, CSRF and personal-finance suites. |
| Backend/frontend/shared ESLint | Passed with zero warnings.                                                                                                                   |
| Configured Prettier            | Passed. New documentation additionally requires the explicit check below.                                                                    |
| Production frontend build      | Passed.                                                                                                                                      |
| Production dependency audits   | Zero vulnerabilities in both packages.                                                                                                       |

The final targeted command also passed **26 tests** (22 staged MongoDB/HTTP and four pure contract cases), with zero failures/skips. The explicit new-document Prettier check and final `git diff --check` passed. Final database inspection found **zero remaining disposable test/rehearsal/restore namespaces**.

An earlier existing cycle-model suite reported its database dropped, but final inspection found that same run-owned namespace recreated with only an empty `transactions` collection. It was identified by the captured run log, removed explicitly after all workers stopped, and absence rechecked. Late model/index initialization is a possible cause, not a proven diagnosis. Existing-suite teardown reliability therefore remains a tooling follow-up; no development data was read or modified for cleanup.

One intermediate full run rejected three valid settlement-confirmation responses after the adapter called validation on query-returned documents carrying a transient immutable-currency error. The adapter now validates a fresh data snapshot through the same model rules, without saving it, suppressing errors or modifying any model/financial protocol. The final full run passed these cases and the corrupt-replay rejection test.

The root formatter covers new backend files and README, but not this newly added documentation path; the explicit documentation check is required. This milestone adds no new process-kill test; the existing lifecycle and migration SIGKILL/fresh-process suites passed as regressions in the clean gate.

## Remaining activation prerequisites

- Public routes remain unregistered; no version-2 frontend or production cookie/deployment walkthrough is implemented.
- Review and implement a coordinated strict frontend DTO/service update before exposing this envelope.
- Review future startup readiness under actual runtime credentials, stricter post-migration validators, and metadata-probe performance.
- Separately authorize and verify any real migration, maintenance release and new-binary-only startup. No held rehearsal database is released here.
- Decide whether future current members should read historical cycles' balances; the inherited snapshot restriction is retained.
- No owner succession, departures, reversals, archival, automatic financial synchronization, payments or production/cloud/Atlas verification.
- This milestone's interruption tests inject faults and delay workers. They do not claim a new OS-process-kill, network partition or Atlas failover experiment; existing lower-level process-kill suites run as regressions.
