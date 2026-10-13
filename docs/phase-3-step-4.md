# Phase 3, Step 4 — Recurring transaction backend

Implemented on 2026-10-13. This stage is backend-only: no recurring UI, payments,
notifications, bank integrations or external scheduler. Schedules are templates,
not money already received/spent. Only generated personal transactions contribute
to the ledger, dashboard and budget spending.

## Schedule schema and indexes

`RecurringSchedule` contains authenticated `owner` (immutable ObjectId), `type`,
`title`, positive safe integer `amountMinor` in paise, `currency` (INR only),
compatible `category`, optional `notes`, `frequency` (daily/weekly/monthly/yearly),
`startDate`, optional `endDate`, `status` (active/paused), `nextOccurrenceDate`,
`createdAt`, `updatedAt` and Mongoose `__v` for optimistic concurrency.

Internal recovery fields are `lastOccurrenceDate` (completed watermark),
`occurrenceNumber` (calendar position), and optional `pending: { date,
transactionId }` (durable reserved work). Public responses hide these fields and
owner, expose `id`, `version`, template fields, next date, `exhausted`, `processing`
and timestamps. Exhaustion means next date is null; it does not add a third status.

Indexes:

- Schedules: `{ owner: 1, _id: -1 }` for owner-scoped keyset listing.
- Schedules: `{ status: 1, nextOccurrenceDate: 1, _id: 1 }` for due scans.
- Transactions: unique `{ recurringSchedule: 1, scheduledDate: 1 }`, partial filter
  requiring ObjectId/date provenance. Manual entries are unaffected.
- Existing transaction owner/date/ID and owner/amount/ID indexes remain intact.

Generated transactions add immutable `recurringSchedule` and `scheduledDate`
provenance, plus an optional internal `deletedAt` receipt marker. These are never
accepted in user transaction input. Both provenance fields must be present together;
manual records cannot acquire a deletion marker through the validated model path.
No replica set or MongoDB multi-document transaction is required.

## UTC calendar rules

Dates use the existing canonical `YYYY-MM-DDTHH:mm:ss.sssZ` validation: invalid
calendar dates, offsets and malformed values are rejected. Start years are 0001–9999.
The first occurrence is startDate. End is inclusive and cannot precede start.
Every subsequent occurrence is strictly later; dates beyond year 9999 exhaust.

Daily and weekly advance by UTC calendar days (one/seven). Monthly and yearly
calculations always use the original start's UTC clock, milliseconds and intended
day, clamping to the last valid day only for the current occurrence. January 31
therefore produces February 28/29 then March 31; January 29/30 also recover their
original day after February. Yearly February 29 becomes February 28 in non-leap
including century years such as 2100, then February 29 in leap years.

## API contract

All endpoints require the existing JWT cookie. Mutations require the configured
Origin and `X-CSRF-Protection: 1`; POST/PATCH require JSON. Every response uses
`Cache-Control: no-store`. Unknown fields, operators, ownership overrides and
protected/internal fields are rejected. Money/category validation reuses the
transaction schemas. Negative, zero, fractional, unsafe and non-finite amounts
are rejected; no monetary rounding or currency conversion occurs.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/recurring` | Create schedule, 201; does not directly create a transaction |
| GET | `/api/recurring` | List only owned schedules, 200 |
| GET | `/api/recurring/:id` | Retrieve owned schedule and ETag, 200 |
| PATCH | `/api/recurring/:id` | Full resulting-template validation and atomic version update, 200 |
| DELETE | `/api/recurring/:id` | Hard-delete schedule only, 200 |
| POST | `/api/recurring/:id/pause` | JSON `{}`, If-Match; set paused, 200 |
| POST | `/api/recurring/:id/resume` | JSON `{}`, If-Match; set active, 200 |
| POST | `/api/recurring/process` | JSON `{ "limit": 20 }`; process caller's due work, 200 |

Example creation:

```json
{
  "type": "expense",
  "title": "Monthly subscription",
  "amountMinor": 125050,
  "currency": "INR",
  "category": "subscriptions",
  "frequency": "monthly",
  "startDate": "2026-10-31T09:00:00.000Z",
  "status": "active"
}
```

Success envelope is `{ "status": "ok", "data": { "schedule": ... } }`.
Single-record create/read/update/lifecycle responses include
`ETag: "tn-<schedule-id>-v<version>"`. Send that exact quoted value as If-Match
for PATCH/pause/resume. Missing precondition returns 428; malformed or mismatched
ID returns 400; stale version returns 412. Atomic races return 409. Pending
reserved work returns 409 `RECURRING_BUSY`: process due work and reload before
retrying. A reservation and its completion each increment version, so background
processing can invalidate an otherwise unchanged template's ETag. No automatic
client retry or silent overwrite is performed. DELETE follows existing deletion
conventions (no If-Match), but is atomically blocked while work is reserved.

Listing accepts only `status`, `limit` (default 20, maximum 100) and `after` (last
ObjectId). Order is `_id DESC`; query returns limit+1. Envelope:

```json
{
  "status": "ok",
  "data": { "schedules": [] },
  "pagination": { "limit": 20, "hasMore": false, "nextAfter": null }
}
```

Follow nextAfter using after and consistent filters. This public ID keyset is not
a snapshot; every page still enforces authenticated owner scope. Malformed IDs
return 400. Missing/foreign-owned records return identical 404
`RECURRING_NOT_FOUND`. Errors use `{ status: "error", code, message }` and hide
internal failures in every environment.

Processing accepts only a numeric limit, 1–100 (default 20). No client owner,
clock, arbitrary date or global processing option is accepted. Response:

```json
{
  "status": "ok",
  "data": {
    "processing": {
      "attempted": 0,
      "generated": 0,
      "recovered": 0,
      "advanced": 0,
      "conflicts": 0,
      "errors": 0,
      "hasMoreDue": false
    }
  }
}
```

Attempts include races and failures, not just inserted entries. Recovered means
an existing durable receipt was reused. HasMoreDue is a best-effort indication at
batch end. Routes allow 300 requests per user/15 minutes; process additionally
allows 10 per user/15 minutes. These in-memory counters are process-local and reset
on restart, consistent with existing local rate-limit infrastructure.

DELETE returns `{ status: "ok", message: "Recurring schedule deleted" }`.
Generated transaction read responses optionally include
`recurrence: { scheduleId, scheduledDate }`. Normal transaction fields and update
protocol remain intact. Provenance is independent of a live schedule and is never
populated, so deleted schedules do not break historical queries.

## Edits and lifecycle

PATCH supports the template fields, frequency/start/end and status; notes/endDate
can be cleared with null. Full category/type invariants are revalidated. Completed
occurrences are never rewritten or regenerated. Future work is rebased against
the completed watermark: the next date must be at or after the new anchor and
strictly after the last completed date. Uncompleted overdue dates use the edited
template; moving an anchor/frequency may intentionally skip old uncompleted dates.
Backdating cannot regenerate completed history. An end before the watermark may
exhaust; extending it can make new later dates eligible.

Pause retains the cursor and produces no new work. Resume catches up missed
eligible dates gradually, including dates missed during pause. Reservations freeze
work: edit, pause and delete cannot succeed until the pending occurrence finishes.
This intentionally favors financial recovery over immediately cancelling already
reserved work. Historical generated transactions remain editable through normal
transaction APIs without altering schedule templates or provenance.

## Idempotency and failure recovery

Each occurrence follows a standalone-compatible durable outbox sequence:

1. Atomically compare owner/ID/version/active/no-pending and reserve the occurrence
   with a fixed transaction ID. Increment schedule version.
2. Validate the full financial document and insert it with schedule/date provenance.
   On a duplicate, read and reuse the matching owner's existing receipt, including
   manually edited or deleted historical entries. Never overwrite that receipt.
3. Atomically compare owner/ID/version and exact pending date/ID, then set the
   completed watermark/new calendar cursor, clear pending and increment version.

The unique index prevents concurrent workers inserting duplicate occurrences.
Multiple workers may complete the same reservation, but only one advancement CAS
succeeds. There is no process-local correctness lock or lease expiration to lose.
The pending record persists across failures/restarts and remains recoverable.

Schedule writes, generated inserts and generated deletion receipts require journaled
majority acknowledgement with a two-second write-concern timeout. Standalone MongoDB
has a one-member majority. Majority due/receipt reads prevent advancing based on an
uncommitted receipt on replica sets; unknown write outcomes are safe to retry.
Actual standalone Docker MongoDB was tested; Atlas/replica-set failover was not.

| Failure point | Recovery |
| --- | --- |
| Before reservation/insertion | Still due; reserve or reuse pending on next batch |
| After insertion, before advancement | Unique receipt reused; advance cursor without rewriting history |
| During advancement / lost acknowledgement | Next read discovers pending or completed state; retry is safe |
| Concurrent worker | Reservation/advancement CAS and unique index settle the race |
| Edit/pause/delete during reservation | 409 busy; no template mutation can alter frozen work |

Generated transaction DELETE intentionally stores a hidden durable tombstone rather
than removing the uniqueness receipt. All normal transaction reads/updates,
dashboard and budget aggregations exclude it. It cannot resurrect on retries,
even when deletion occurs between insertion and advancement. Manual transaction
DELETE remains hard deletion. Schedule deletion preserves both visible history
and hidden receipts. Receipts currently retain the full deleted record indefinitely;
do not purge them without transferring idempotency to another durable receipt store.
Raw database edits/purges can bypass these protections and are unsupported.

There is no cross-collection point-in-time transaction: an inserted transaction may
be visible briefly while the schedule remains pending. This is completed persisted
financial data, not a duplicate template. Existing dashboard/budget best-effort
consistency semantics remain unchanged.

## Catch-up and hosting

`processDueSchedules` is reusable and takes an optional trusted internal owner
scope and bounded limit. It processes earliest due dates using database queries,
not by loading the schedule collection. Errors/conflicts consume the work budget;
failed schedules are skipped for the rest of that invocation and retried later.
An invocation captures a single as-of UTC timestamp and checks a soft five-second
elapsed budget between iterations. MongoDB operations have query/write budgets;
the five-second bound is not a hard request deadline during network outages.

`server.js` initializes required indexes before listening, runs one batch of 20
immediately after startup, then runs the next 60 seconds after the previous batch
finishes. One local job never overlaps itself; independent processes safely share
the database protocol. Shutdown stops scheduling and waits for active work before
MongoDB disconnect, subject to the existing ten-second shutdown deadline.

The HTTP process route is owner-only, CSRF-protected and rate-limited; trusted
startup/background processing is the only global scan. Logs contain batch counts
or a generic failure message, never raw documents, tokens or driver error details.

A sleeping free-tier host performs no scheduled work. On wake/restart, repeated
bounded batches catch up persisted overdue work; records carry their scheduled
UTC date, not processing time. Very large backlogs take multiple batches. There
is no guaranteed execution-at-time SLA, external scheduler, notification system or
auto-payment. Persistently corrupt stored schedules can keep failing and may
require trusted inspection/repair; there is no automatic quarantine/repair policy.

## Files and architecture

New files:

- `src/models/recurring.model.js`
- `src/repositories/recurring.repository.js`
- `src/services/recurring.service.js`, `recurring-engine.service.js`
- `src/controllers/recurring.controller.js`, `src/routes/recurring.routes.js`
- `src/validators/recurring.validator.js`
- `src/utils/recurrence.js`, `durable-write.js`
- `src/jobs/recurring.job.js`
- `tests/recurring.test.js`, `tests/helpers/recurring-api.js`,
  `tests/helpers/recurring-repository.js`
- `integration/recurring.mongo.js`

All paths above are relative to backend. Modified app/server wire routes, indexes
and job lifecycle. Transaction model/repository/service implement immutable
provenance, unique receipt constraints and public serialization. Dashboard and
budget-summary repositories exclude tombstones. Error middleware sanitizes recurring
failures. Existing transaction test assertions preserve coverage while reflecting
new ownership/deletion predicates and the new index. Package test:mongo includes
the recurring integration suite. README and this specification document behavior.
No dependencies, `.env` secrets, frontend files or real financial data were changed.

## Verification

Executed against Node.js 24 and existing local Docker MongoDB:

| Check | Result |
| --- | --- |
| `npm test --prefix backend` | 237 passed, 0 failed/skipped; includes 27 recurring tests |
| `npm run test:mongo --prefix backend` | 75 passed, 0 failed/skipped; includes 19 recurring tests |
| `npm test --prefix frontend` | 122 passed across 12 files |
| Both package ESLint commands | Passed, zero warnings |
| `npm run format:check --prefix frontend` | Passed; backend has no configured Prettier check |
| Both `npm audit --omit=dev` commands | Zero vulnerabilities |
| `git diff --check` | Passed |

Docker MongoDB was started with `docker compose up -d --wait mongodb`.
Each MongoDB suite used a uniquely named disposable database and dropped it after
completion. A separate database-name check confirmed all five final-run databases
were absent afterward. The final recurring run used
`tallynest_recurring_test_1791895413940_9964276b0ea3`. No development database was
used. Real tests exercised unique constraints, concurrent workers, exact money,
interrupted insert/advance recovery, pending mutation conflicts, deletion receipts,
historical preservation, ownership, bounded catch-up and dashboard/budget inclusion.

Failure recovery was tested through injected failures at write boundaries and
fresh engine instances over persisted MongoDB state, not actual OS termination,
power loss or replica-set failover. No new browser walkthrough was performed for
this backend-only stage; all existing frontend regression tests passed.
