# Phase 5, Step 3B — settlement cycle model and compatibility foundation

This milestone adds storage definitions and validation only. It does **not** create cycles during ordinary requests, associate existing financial records with cycles, expose cycle endpoints, or enable expenses after the first settlement proposal. The reviewed architecture remains in [Step 3A](phase-5-step-3a-cycle-design.md).

## Findings against the design

The current `Group` collection validator rejects unknown properties, and the expense and settlement validators do the same. Optional association fields therefore need explicit compatibility-validator entries before any staged migration can write them. The current `financialOperation` schema permits only six legacy operation kinds and has no `checking`/`applying` phase. This milestone deliberately does not extend or use it. The current React expense response schema is strict, so existing DTOs omit `cycleId` even when an internal test fixture has one.

## Model and indexes

`GroupFinancialCycle` uses its MongoDB `_id` as the immutable identity. It stores `group`, positive safe-integer `sequence`, optional `previousCycleId` (required after sequence 1), `INR`, `status` (`open`, `frozen`, `closed`), immutable sorted `memberIds`, UTC `openedAt`/optional `frozenAt`/`closedAt`, Mongoose timestamps, `__v`, and fixed open/freeze/close operation IDs. An open or frozen document carries `activeSlot: true`; a closed document has no `activeSlot`. This is a dedicated `groupfinancialcycles` collection. No balances or other financial caches are stored.

Startup awaits `ensureGroupFinancialCycleIndexes()`, which creates or updates a strict, error-action collection validator and awaits model index initialization. The indexes are:

| Key                                                          | Purpose                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Unique `{ group: 1, sequence: 1 }`                           | One cycle number per group.                                                   |
| Unique `{ group: 1 }`, partial filter `{ activeSlot: true }` | At most one open **or frozen** cycle per group; closed cycles leave the slot. |
| `{ group: 1, sequence: -1, _id: -1 }`                        | Future deterministic, bounded group history.                                  |

MongoDB's partial filter tests equality with `true`; it does not attempt an unsupported `$ne` or arbitrary expression. The collection validator checks types, safe integer bounds, valid status/slot/timestamp/receipt combinations, ordered unique member IDs and version integrity. Mongoose validation additionally rejects invalid model instances and marks identity, group, sequence, member snapshot, currency and operation IDs immutable. Raw MongoDB updates cannot be constrained against a previous document value by a collection validator; later transition repositories must enforce monotonic CAS and immutable-field predicates. The pure helpers in `src/utils/group-financial-cycle.js` define legal status transitions, sorted snapshots, safe sequence increments and group association without adding a write route.

## Staged compatibility

`Group` accepts optional `currentCycleId`, `cycleEpoch`, `currentCycleState`, and `financialProtocolVersion` fields. Existing records are left absent; group creation does not set them. Version 2 is reserved for a **future** cycle-aware protocol. Later financial writers must atomically require that protocol version together with the current cycle ID, epoch, state, membership, document version and reservation. Old binaries do not check those predicates and must be stopped before cutover. These optional fields do not currently authorize anything.

`GroupExpense` and `GroupSettlement` accept optional immutable `cycleId` ObjectIds at both Mongoose and MongoDB-validator levels. Existing records need no backfill in this milestone and current authenticated create/update paths do not accept or set this field. Collection validators retain all existing amount, split, status, identity, receipt and tombstone requirements. Existing unique creation-receipt indexes are unchanged. Future migration must backfill every live expense, tombstone and settlement before a stricter required-cycle validator and cycle-aware financial operations can be enabled.

The permanent `financialHistoryAt` marker, group deletion and member-removal predicates, and `settlementStartedAt` expense-reservation predicate are unchanged. The current group-wide balance aggregation is unchanged. DTO mappers intentionally omit cycle fields. No personal transaction, budget or recurring schema or data changes are made.

## Verification and limitations

The targeted Node tests cover pure state/sequence/snapshot helpers and model validation. Disposable MongoDB 8.0 tests inspect actual indexes and strict validators, reject raw malformed documents, demonstrate active-slot/sequence uniqueness and multiple closed history rows, and check legacy records, creation receipts, tombstones, balances and the old freeze predicate. The test database is dropped and its absence verified in teardown. Existing API and frontend regression suites remain the compatibility checks for response envelopes.

Local verification on 2026-10-16: `npm run verify:clean` passed with 304 backend tests, 248 frontend tests, 161 MongoDB integration tests, backend/frontend/shared lint, configured formatting, production frontend build and both production audits. The focused cycle suite was rerun after its final assertion additions: 2 unit and 6 MongoDB tests passed. `git diff --check` and a direct Prettier check of this new document passed. Disposable cycle test and probe databases were checked and removed. The root formatting script currently lists only selected documentation files, so this document needs its explicit check until a later tooling update includes it.

The model can represent multiple historical cycles, but no production path can open, freeze, close, list or financially use one yet. There are no owner/member-scoped cycle reads: exposing staged or partially migrated records would require a reviewed visibility protocol. Database validators cannot enforce foreign-key group membership, cross-document pointer agreement, or historical immutability against privileged raw writes. No migration or legacy data rewrite has run. The next milestone must implement and fault-test the cycle-aware write reservation before any feature activation; the later migration needs an old-worker shutdown and verified backup.
