# Phase 5, Step 3D — internal settlement cycle lifecycle and recovery

**Activation status: inactive.** This milestone implements internal lifecycle services for disposable version-2 fixtures. There are no public lifecycle routes, environment activation switches, frontend controls, migrations, or automatic cycle creation. Legacy groups still use the permanent `settlementStartedAt` expense freeze. Existing public expense/settlement services continue rejecting version-2 groups.

## Current-code findings and reviewed design adjustments

The Step 3C coordinator already serializes financial writes through `Group.financialOperation`, binds effects to fixed document IDs, and freezes a cycle on its first capacity-valid settlement proposal. The cycle model already has immutable opening/freezing/closing operation IDs, a unique group/sequence index, and a unique active slot. These behaviors remain.

Two concrete extensions were necessary:

- `Group` validation previously required the current pointer and epoch to equal the reservation's source throughout the operation. Opening changes that pointer. Validation now admits a tightly bounded applying-phase opening state: the pointer equals that same operation's fixed target, the epoch is exactly source epoch plus one, and the mirror state is open. Bootstrap additionally permits a missing pointer/state at epoch zero. Other financial reservations keep their existing association requirements.
- An operation ID on a cycle cannot resolve a reused UUID intent across different transition kinds or after subsequent cycles. A separate `GroupCycleTransition` journal stores a durable, group-wide UUID hash and the complete fixed intent. It is a receipt, not another lock. The existing group reservation is still the only serialization boundary. This extends Step 3A's transition-receipt proposal without changing financial semantics.

Relevant files are `services/cycle-lifecycle.service.js`, `utils/cycle-lifecycle.js`, `models/group-cycle-transition.model.js`, `repositories/group-cycle-transition.repository.js`, and the existing group/cycle repositories and validators. The Step 3C recovery method explicitly directs lifecycle reservations to the lifecycle coordinator instead of treating them as settlements. Lifecycle recovery can dispatch ordinary cycle financial operations to the existing coordinator, using the same injected repositories.

## Internal interfaces and permissions

Construct `createCycleLifecycleService({ internalEnabled: true })` explicitly in internal fixtures. Its default is disabled. Nothing in the production router constructs this factory. Even an enabled instance requires authoritative `financialProtocolVersion: 2`; it never changes that field.

```js
await service.openFirst(actorId, groupId, {
  intent: crypto.randomUUID(),
  groupVersion: 0,
});

await service.freeze(actorId, groupId, {
  intent: crypto.randomUUID(),
  groupVersion,
  cycleId,
  cycleVersion,
  epoch,
});
// close(...) and openNext(...) accept the same transition input.
await service.recover(actorId, groupId);
```

Inputs are strict Zod schemas. UUIDs and IDs are normalized before hashing; unexpected fields, client roles and operators are rejected. Expected versions are required safe nonnegative integers, with headroom for protocol increments. Epochs are positive for existing cycles; overflow is rejected. Initial sequence/epoch are one. Sequences and epochs are not calendar dates. Cycle names remain automatic sequence labels.

Only the current creator with an authoritative owner membership may open, explicitly freeze, close, or recover a lifecycle transition. An outsider receives the existing non-disclosing group-not-found error; an ordinary member cannot impersonate the owner. Recovery of an existing financial write retains Step 3C actor/owner authorization. No public HTTP endpoint or new CSRF surface is introduced.

A successful transition returns `{ receipt, replayed }`. The internal receipt contains its fixed operation identity, original intent metadata, target cycle, committed outcome, and completion time. It is **not a new public DTO**. An identical retry must retain the complete original input, including expected versions and UUID. It resolves the original receipt even after later cycles have opened. Changed input or a different transition using the same accepted UUID returns `IDEMPOTENCY_CONFLICT`. Invalid requests cancelled during checking do not consume a journal key; callers should review authoritative state and use a new intent for a revised request.

## Lifecycle and financial semantics

```text
cycle-less v2 fixture → Open Cycle 1
Open → Frozen → Closed → New Open Cycle
```

There is no thaw, reopen, debt rollover, forgiveness, automatic next cycle, or modification of historical confirmed settlements. An empty cycle can explicitly freeze and close. Rejected proposals do not thaw a frozen cycle. The existing first-valid-proposal freeze still works independently of explicit freeze.

**Explicit freeze** reserves the open current cycle, verifies expected versions and owner/snapshot membership, then moves checking to applying. The cycle CAS sets `frozenAt` and `freezeOperationId` once; the group mirror changes to frozen. Explicit freeze starts settlement mode even without a proposal, setting the earliest-ever `settlementStartedAt` marker only when absent. Subsequent cycles preserve that marker unchanged. Freeze is irreversible.

**Close** reserves a frozen current cycle, then recomputes MongoDB aggregates matching both group and cycle IDs while holding the reservation. The existing integrity facets validate expenses, tombstones and settlements. Exact Decimal128/Int64 aggregation and BigInt reconciliation must establish:

- paid totals equal assigned totals;
- confirmed sent equals confirmed received;
- signed net positions sum to exactly zero;
- every individual net position is zero;
- every pending sent/received reservation is zero;
- every individual and aggregate result is within the existing safe-integer boundaries.

A prior balance response is never trusted. Pending, rejected, confirmed and deleted-record semantics are unchanged. A pending proposal prevents closure; rejection contributes no money and never reopens expenses. Corrupt records and unsafe aggregates fail closed. The cycle CAS sets closed status/time/receipt and removes `activeSlot` in the **same document write**. The group then mirrors closed. Until reconciliation and release complete, its operation slot continues blocking financial activity; a closed cycle record alone does not signify that the group is available.

**Open next** requires the current cycle to be closed and version/epoch aligned, no active cycle, and revalidated zero obligations/no pending capacity. It allocates the target ObjectId once, advances sequence and epoch safely, sets `previousCycleId`, snapshots the current roster in stable sorted order, and creates an INR open cycle. The group pointer is attached afterward. Cycle 2 starts with real zero financial positions because no source records are moved or copied. Other cycles never enter its aggregation. Financial creation keys remain group-wide; retrying a Cycle 1 expense after opening Cycle 2 resolves the original receipt or conflicts, never inserts into Cycle 2.

**Open first** accepts only a cycle-less version-2 fixture with no prior settlement marker. While holding its reservation it verifies that no cycle, expense (including tombstones), or settlement exists for the group. It establishes the permanent history marker atomically with reservation acquisition, uses temporary epoch zero, and creates sequence one with a fixed ID before committing pointer/epoch one. A cancelled or failed bootstrap can leave the conservative permanent history marker and epoch zero; they are never erased to permit deletion. It can be retried after reviewing the failure if genuinely empty. This is not a legacy migration or automatic bootstrap path.

## Atomic predicates, records and indexes

The initial group reservation CAS requires group ID, creator plus owner membership, protocol version two, expected group version, an empty operation slot, and the expected source pointer/state/epoch. Bootstrap requires absent pointer/state, absent settlement marker and absent-or-zero epoch instead. Existing-cycle operations require the permanent history marker. Membership and deletion protections therefore remain effective before any new cycle is visible.

Promotion requires the same operation ID/hash/source identity, checking phase, and exactly the reserved group version. Cycle transitions require group/cycle identity, expected cycle version, source status, active slot, and an absent corresponding transition receipt. They atomically change status and version. Group mirroring and release require the same operation ID/hash/owner/protocol plus the appropriate source or target pointer/epoch/state. A delayed original worker cannot mirror or release a different operation or next cycle. A delayed external write either loses its source-version/status CAS, or collides with its already-persisted fixed target and reconciles the existing receipt.

The new journal stores immutable group/actor/intent hashes, operation hash and complete normalized intent, kind, target cycle, outcome, and creation time. Completion is a single version-zero to version-one CAS with `completedAt`; there is no journal delete/edit API. Its unique `{ group: 1, intentKey: 1 }` index binds UUID intents across transition kinds and cycles. Existing cycle indexes continue enforcing unique `{ group, sequence }` and one `{ group }` active slot through the partial `activeSlot: true` index. Closed cycles have no active slot.

Mongoose immutability and strict collection validators enforce record shape, allowed values, owner/group associations, numeric boundaries, and receipt envelope structure. Hash checks detect altered durable intents and receipts during replay/recovery. Hashes are not MACs against an administrator. MongoDB collection validation cannot compare an old document with its replacement or enforce cross-collection state. Historical immutability, financial checks and cross-document ordering depend on all writers honoring the single group reservation protocol and fixed-ID/version predicates. Out-of-band administrative changes remain an operational risk.

`ensureCycleTransitionIndexes()` installs and awaits the journal validator/index in disposable suites. It is deliberately **not called by ordinary application startup**. Installation/preflight must be added to a reviewed activation/cutover milestone; activation without that unique index is prohibited.

## Durable sequence and recovery

1. Reserve the complete fixed operation and establish history protection where needed.
2. In checking, validate identities, source versions, state, arithmetic, absence of pending obligations, and opening eligibility. No external financial or cycle effect occurs here.
3. CAS the same reservation to applying. It has no expiry or lease takeover.
4. Insert/reconcile the fixed-ID journal with its unique intent hash before any cycle effect.
5. Insert the fixed new cycle or CAS the existing cycle transition.
6. CAS the group mirror/pointer to the intended target and epoch.
7. Prove cycle receipts and group mirror agree, then mark the journal complete.
8. Release that same group reservation; reject success if it still remains unresolved.

Recovery reuses the original operation ID, actor, group, source cycle/epoch, target ID, versions, timestamp, normalized payload and hash. It never manufactures a new target. The actor/owner rules and hashes are checked again. An applying operation cannot be cancelled because it is old. An unknown or corrupt outcome remains busy with a sanitized error; there is no force-unlock API.

| Interruption                                       | Recovery                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Before reservation                                 | No effect; request can retry with original input.                                                                             |
| After reservation or checking                      | Revalidate and promote, or cancel only a still-checking definite validation conflict. History protection remains.             |
| Applying before journal/effect                     | Insert/reconcile the same journal, then the same target.                                                                      |
| Cycle frozen/closed, mirror still old              | Recognize immutable transition operation ID, finish mirror and receipt. Closed status and active-slot removal are atomic.     |
| New cycle inserted, pointer still old              | Recognize `openOperationId` and exact fixed target/snapshot/sequence; attach that cycle without allocating another.           |
| Mirror written, receipt incomplete                 | Prove target association/state under the same slot, complete receipt, release.                                                |
| Receipt complete, release uncertain                | Reconcile the original slot and release only that operation; never unset a newer operation.                                   |
| Original worker resumes after recovery/later cycle | Fixed-ID uniqueness, source-version CAS, operation-bound mirror/release and historical receipt replay prevent stale mutation. |

Lifecycle times use a fixed effective UTC timestamp no earlier than the preceding lifecycle timestamp. No timer determines correctness. Recovery intentionally sacrifices availability when evidence is insufficient. The public recovery endpoint remains legacy-only.

## Verification and practical limits

The new unit suite covers strict UUID/version inputs, inactive factories, exact closure criteria and intent hashing. The real MongoDB suite covers first bootstrap, explicit freeze/close, two complete financial cycles, original receipt replay, tombstones, pending/nonzero/corrupt/overflow rejection, owner authorization, stale versions/epochs, unique indexes, malformed receipts, and source-data isolation.

Independent MongoDB connections exercise concurrent freeze/close/open requests, duplicate UUIDs, expense versus freeze, confirmation versus close, repeated recovery, delayed original workers and pointer-commit availability. Four transitions each run through eleven injected stop boundaries (44 cases): after reservation, checking, promotion, journal insertion, before/after cycle effect, before/after mirror, after journal completion, before release and after release. Separate repository wrappers simulate lost acknowledgements after committed journal and pointer writes.

A real child process is killed with **SIGKILL after next-cycle insertion while applying**. A fresh child process then reconnects, recovers the original target and commits its pointer. This verifies that specific OS-process interruption on standalone local MongoDB. It does not test host power loss, network partitions, replica-set elections, Atlas failover, or migration/cutover with old binaries.

Run:

```bash
npm run verify:clean
cd backend
node --test tests/cycle-lifecycle.test.js
node --test integration/cycle-lifecycle.mongo.js integration/cycle-financial-writes.mongo.js
```

All MongoDB suites use uniquely named disposable databases and drop them afterward. No development records, `.env` settings, dependency versions, personal finance contracts or frontend files are changed. The root formatting script currently enumerates older documents; explicitly check this specification with:

```bash
npm exec --prefix frontend -- prettier --config frontend/.prettierrc.json --check docs/phase-5-step-3d.md
```

Before activation, the remaining required milestones are legacy migration/reconciliation with preserved frozen history and creation receipts, backup/restore rehearsal, shutdown of old binaries, startup validator/index preflight, public API/DTO and frontend coordination, and operational recovery procedures. Owner succession, departure, reversals and archival policy remain outside this implementation.

## Executed local verification

On Node.js 24.21.0 and standalone Docker MongoDB 8.0.32:

- `npm run verify:clean` completed successfully: 308 backend unit/HTTP tests, 248 frontend tests across 20 files, and 201 real MongoDB integration tests, with no failures or skips.
- The targeted lifecycle unit, lifecycle MongoDB and unchanged Step 3C suites passed 44 tests: four new unit tests, 27 lifecycle integration tests and 13 Step 3C integration tests. The lifecycle integration count includes the 44-boundary fault matrix and actual SIGKILL recovery case described above.
- Backend/frontend/shared ESLint, configured Prettier checks, frontend production build and both production dependency audits passed; each production audit reported zero vulnerabilities.
- The new specification requires a direct Prettier check because the root document allowlist does not include it. `git diff --check` is also a separate final gate.
- The clean run dropped all 13 disposable databases. Two empty databases recreated by automatic index initialization after early failed setup attempts were also removed by their exact disposable names; teardown now drains model initialization before dropping its database. No development database was used.

No GitHub Actions execution, browser walkthrough, Atlas failover or migration rehearsal is claimed for this internal backend milestone.
