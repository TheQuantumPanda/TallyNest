# Phase 4, Step 4 — Group balances and settlements

Backend-only. No payments, collaborative frontend, personal-ledger synchronization,
notifications or currency conversion are implemented. All money is integer INR paise.
A confirmed settlement records recipient acknowledgement; it is **not proof of a bank payment**.

## Financial-history policy

The permanent `financialHistoryAt` marker from Step 3 still prevents group deletion,
member removal and voluntary departure, even if all expenses were tombstoned.
Original deleted-expense documents and idempotency receipts are preserved.

The first valid settlement proposal establishes immutable `settlementStartedAt`.
From then on **all expense creation, editing and deletion is blocked**, including
through the pre-existing expense routes. This conservative policy freezes more than
just previously created expenses. Rejection of every proposal does not unfreeze the
group. Metadata edits and invitations remain available; new members have zero history.
Neither a group's roster nor current display names define historical allocations.

Pending settlements can only become confirmed or rejected once. Terminal records
have no PATCH, DELETE, cancellation or reversal API. Confirmed errors cannot be corrected
in this phase: participants must reconcile outside the application; a future explicit,
audited reversal design is required before corrections can be represented. Nothing
silently rewrites history or creates personal transactions.

## Standalone-compatible financial serialization

A group contains at most one durable `financialOperation` reservation:
`_id`, authenticated `actor`, `kind`, a frozen validated `payload`, and `createdAt`.
Kinds cover expense create/update/delete and settlement create/confirm/reject.
The payload captures the fixed destination ID, financial data, idempotency digests,
and expected document version where relevant. It is internal and never returned.

1. Authenticate and validate the complete request and identities. Establish the
   existing history lock before an expense can be persisted.
2. Atomically reserve the group with a membership predicate, matching group version,
   history marker, and no existing operation. Expense reservations also require
   settlement mode to be absent **in the database predicate**.
3. Apply exactly the frozen operation. Expense update/delete and settlement decisions
   use target-version CAS; creates use fixed IDs and unique creation receipts.
   Writes stamp `lastFinancialOperation` so repeated workers recognize their own effect.
4. Release only the matching reservation after acknowledging its result. Reservation
   and release increment the group version; clients must reload group ETags for metadata
   or membership operations after financial mutations.

A settlement proposal calculates available capacity while holding the reservation,
then establishes settlement mode **before** insertion. Expense writers cannot run
between that validation, mode establishment and insertion. A crash may leave a mode
marker without a settlement: this permanent false-positive freeze is intentional.

Reservations **never expire and are never forcibly stolen**. No cross-document MongoDB
transaction, lease TTL or in-memory mutex is claimed. An old process may resume after
recovery; its frozen ID and version CAS prevent another write of the same effect, even
if a later operation or settlement has completed. Recovery does not replace the payload.
Concurrent recovery workers are safe through the same unique IDs, CAS and durable
operation receipts. Domain failures with no remaining effect clear the reservation;
unknown driver outcomes retain it. A concurrent worker's acknowledged receipt is
checked before reporting a domain failure. Majority journaled writes are used;
standalone majority is one member, not cross-document atomicity.

`POST /api/groups/:id/financial-recovery` with `{}` replays **one** pending operation.
Only its actor or the group owner can recover it. Returns
`{ "status": "ok", "data": { "recovered": true } }`, or false if none remains.
There is no automatic retry loop, scheduler or unsafe unlock endpoint. A crashed
reservation can block financial writes and balance reads until explicit recovery.
A persistent driver or corrupted-data failure may require operator investigation.
Do not remove the reservation or edit the frozen payload manually. Stop old-version
workers before deploying this change: every application financial writer must use
this protocol. Direct administrative database writes bypass application authorization.

## Balance aggregation and debt suggestions

`GET /api/groups/:id/balances` accepts no query parameters and requires membership.
MongoDB runs two group-scoped aggregations; it does not return expense history to
application memory. Valid tombstoned expenses are excluded from totals; their
receipts still undergo integrity checks so a malformed deletion marker cannot
silently hide spending. Facets check stored schema,
financial allocations, category/currency, audit status and member identities before
returning bounded per-member totals. Invalid source records fail closed with no
partial summary (unsafe/corrupt totals normally return 422; malformed BSON that
causes a database expression error returns a sanitized failure).

Aggregation converts each safe integer through Int64 to Decimal128, preserving the
full integer digits. Application calculations use BigInt. Individual and aggregate
paid/share/settlement/pending totals, and each signed net, must fit safe JSON integer
bounds. Conservative overflow rejection also applies to total group historical volume,
even when individual member balances would fit. Paid equals assigned, sent equals
received, reserved sent equals reserved received, and all net positions sum to zero.

For member M:

`net = paid − assigned + confirmedSent − confirmedReceived`

Negative means M owes; positive means M is owed. Pending/rejected settlements do not
change net. Pending proposals reserve debtor/creditor capacity separately; they must
not exceed outstanding positions. Remaining budget, bank balance and personal cash flow
are unrelated to this endpoint.

The pure greedy simplifier lexically sorts member IDs, pairs debtors and creditors,
transfers `min(debt, credit)`, and removes exhausted positions. Zero positions are
excluded. It is deterministic, conservative, acyclic and exactly money-conserving.
It does **not** claim a globally minimum transfer count. Suggestions describe current
confirmed-only balances and can overlap pending proposals: inspect pending reservations
before proposing another transfer. Suggestions never create records automatically.

Example response after one equal 10000-paise expense paid by A:

```json
{
  "status": "ok",
  "data": {
    "balances": {
      "groupId": "507f1f77bcf86cd799439040",
      "currency": "INR",
      "settlementMode": false,
      "members": [
        { "user": "507f1f77bcf86cd799439011", "paidMinor": 10000, "assignedMinor": 5000,
          "confirmedSentMinor": 0, "confirmedReceivedMinor": 0, "netMinor": 5000,
          "pendingSentMinor": 0, "pendingReceivedMinor": 0 },
        { "user": "507f1f77bcf86cd799439022", "paidMinor": 0, "assignedMinor": 5000,
          "confirmedSentMinor": 0, "confirmedReceivedMinor": 0, "netMinor": -5000,
          "pendingSentMinor": 0, "pendingReceivedMinor": 0 }
      ],
      "suggestions": [ { "sender": "507f1f77bcf86cd799439022", "recipient": "507f1f77bcf86cd799439011", "amountMinor": 5000, "currency": "INR" } ],
      "netTotalMinor": 0
    }
  }
}
```

A read requires no pending reservation before aggregation and the same group version
with no pending reservation afterward. Concurrent changes return 409 `BALANCE_CHANGED`
or `FINANCIAL_BUSY`, not a partially mixed summary. This is a checked consistency boundary
for participating application writers, not a cross-collection database snapshot.

## Settlement data and indexes

Separate `GroupSettlement`: group, sender, recipient (stable registered User ObjectIds),
positive safe `amountMinor`, INR currency, pending/confirmed/rejected status, createdAt,
confirmedAt or rejectedAt, decisionBy, version, SHA-256 creationKey/creationHash, and
lastFinancialOperation. No private profile data or client-supplied sender is stored.
Version is 0 for pending and 1 for terminal decisions. Sender and recipient differ.
Terminal audit fields identify the recipient and decision timestamp.

Indexes: `{group:1,_id:-1}` for bounded history; unique
`{group:1,sender:1,creationKey:1}` for retry receipts. Existing group/date expense index
supports the group aggregation; no speculative balance indexes are added.
Startup installs strict MongoDB collection validators for financial integer bounds,
status/audit shape, sender/recipient distinction and versions. Mongoose also validates
new records and makes attribution/amount/creation metadata immutable. Collection
validators enforce document state, not transition history or foreign-key membership;
service authorization, reservations and CAS enforce those additional rules.

## Settlement API

All responses use `Cache-Control: no-store`. All endpoints require cookie authentication
and membership; mutations also require configured Origin and `X-CSRF-Protection: 1`.
Group route rate limiting remains 300 requests per authenticated user per 15 minutes
per process. Every settlement lookup is explicitly group-scoped. Outsiders receive
404, never a group's financial information.

| Method and route | Contract |
| --- | --- |
| POST `/api/groups/:id/settlements` | Sender is exclusively the authenticated debtor. Strict `{recipient,amountMinor,currency?}`; INR default. UUID `Idempotency-Key` required. 201 new, 200 identical replay. |
| GET `/api/groups/:id/settlements` | Strict `limit` (default20, max100) and optional ObjectId `after`. Descending `_id`, limit+1. |
| GET `/api/groups/:id/settlements/:settlementId` | Scoped DTO plus ETag. |
| POST `/api/groups/:id/settlements/:settlementId/confirm` | Recipient only, JSON `{}`, matching If-Match; revalidates outstanding balances and atomically confirms pending record. |
| POST `/api/groups/:id/settlements/:settlementId/reject` | Recipient only, JSON `{}`, matching If-Match; releases pending capacity by recording rejection. |
| POST `/api/groups/:id/financial-recovery` | Actor or owner, JSON `{}`; one bounded recovery operation. |

Create example:

```http
POST /api/groups/507f1f77bcf86cd799439040/settlements
Content-Type: application/json
X-CSRF-Protection: 1
Idempotency-Key: 1dd1f4f2-5475-4b10-86b5-31f01c296bbd
Origin: http://localhost:5173

{"recipient":"507f1f77bcf86cd799439011","amountMinor":5000,"currency":"INR"}
```

Single-record response: `{status:"ok",data:{settlement:{id,groupId,sender,recipient,
amountMinor,currency,status,version,createdAt,confirmedAt?,rejectedAt?,decisionBy?}}}`.
Creation also includes `data.replayed`. ETag: `"tn-<settlementId>-v<version>"`.
List: `{status:"ok",data:{settlements:[]},pagination:{limit,hasMore,nextAfter}}`.
Final `nextAfter` is null. Cursor pages are not immutable snapshots; new records may
appear ahead of a traversal, while decisions change existing DTOs without changing IDs.
No raw Mongo operators, projections or arbitrary filters are accepted.

Proposal must fit both debtor's debt minus pending outgoing reservations and recipient's
credit minus pending incoming reservations. Competing proposals serialize; excessive
ones fail 409 `SETTLEMENT_EXCESS`. Confirmation again validates confirmed-only debt and
credit; pending reservations are not treated as payments. Other proposals cannot
silently oversettle the same position. No silent retry or excessive payment recording.

If-Match: missing428 `PRECONDITION_REQUIRED`; malformed/wrongresource400
`INVALID_VERSION`; stale pending version412 `VERSION_MISMATCH`. Terminal repeated
confirm/reject returns409 `SETTLEMENT_DECIDED`, including unknown-network-outcome
retries; GET the record to learn the committed result. Concurrent reservation conflicts
return409 `FINANCIAL_BUSY`. Key reuse with different input returns409
`IDEMPOTENCY_CONFLICT`. Recipient mismatch403 `SETTLEMENT_RECIPIENT_REQUIRED`.
Expense mutation after settlement mode409 `EXPENSES_FROZEN`. Monetary corruption422
`BALANCE_DATA_INVALID`; unsafe totals422 `BALANCE_OVERFLOW`.

## Verification and limitations

Automated unit/HTTP checks are independent of MongoDB. `npm run test:mongo --prefix
backend` includes disposable `settlements.mongo.js` integration tests, registered account
fixtures, raw validation/index checks, concurrent proposals and confirmation, expense
mutation/initialization races, a delayed original worker after recovery and confirmation,
failures at mode/insert/release/decision boundaries, exact maximum integers, corruption,
three-member paise remainders and personal-finance separation. Databases are dropped
and absence checked afterward. Actual OS kill, power loss and Atlas failover are not
simulated; controlled repository failures and suspended workers exercise the boundaries.

Known trade-offs: permanent group and settlement locks; no corrections or archival;
explicit recovery can reduce availability; pending records do not expire automatically;
no unrestricted stale-worker takeover; no external-payment verification; process-local
rate limits; conservative total-volume bounds; no public profile deletion policy;
no cross-document snapshot or atomic transaction. History receipts are retained
indefinitely. Future corrections, member departure, settlement reversals, archival and
shared-to-personal integration require explicit audit and double-counting policies.

### Files

Added: `src/models/group-settlement.model.js`, `src/validators/settlement.validator.js`,
`src/repositories/settlement.repository.js`, `src/repositories/group-balance.repository.js`,
`src/services/group-financial.service.js`, `src/services/settlement.service.js`,
`src/controllers/settlement.controller.js`, `tests/settlement.test.js`,
`tests/helpers/settlement-api.js`, `tests/helpers/settlement-repository.js`, and
`integration/settlements.mongo.js` (backend paths).

Updated: group/expense models, group/expense repositories and services, group routes,
app/server wiring, test:mongo script, isolated group/expense test helpers and expense
recovery assertions. README and Phase 4 Steps 1–3 documents now reference the current
policy. No frontend files, personal financial schemas, dependencies or environment
secrets were changed.

### Executed verification (2026-10-14)

| Command/check | Result |
| --- | --- |
| `npm test --prefix backend` | 296 passed, zero failed/skipped; 11 new unit/HTTP tests |
| `npm run test:mongo --prefix backend` | 145 passed, zero failed/skipped; 18 new settlement integration tests |
| `npm test --prefix frontend` | 165 passed across 15 files |
| Both package ESLint commands | Passed, zero warnings |
| `npm run format:check --prefix frontend` | Passed |
| Targeted Prettier check of eight new production JS files | Passed; backend has no package-wide Prettier script |
| Both `npm audit --omit=dev` commands | Zero vulnerabilities |
| `docker compose config --quiet` and MongoDB service status | Valid configuration; local mongo:8.0 healthy |
| `git diff --check` | Passed |

The final integration run used nine uniquely named disposable databases. The settlement
suite used `tallynest_settlement_test_1791986224639_894475bed427` and every integration suite dropped its own database. A separate
admin name-only inspection checked all 12 recorded full/focused test databases and found
none remaining, including no settlement-test databases. Development/production financial
data was not read or modified. Controlled faults also verified unknown reservation,
mode initialization, insertion and confirmation outcomes, delayed-worker recovery,
concurrent recovery, a stale preflight idempotency check, and deleted-record non-resurrection.
No OS-kill, power-loss, replica-set failover, frontend browser walkthrough or new
frontend build was executed or claimed for this backend-only change.
