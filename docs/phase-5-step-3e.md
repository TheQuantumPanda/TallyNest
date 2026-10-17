# Phase 5, Step 3E — offline cycle migration rehearsal

**Scope:** version 1 of a restartable migration for disposable local MongoDB rehearsal databases. No development/production database was migrated; no public cycle route, frontend control, automatic migration or public cycle write activation is provided. The operator procedure is [the cutover runbook](runbooks/settlement-cycle-cutover.md).

## Safety and implementation findings

The Step 3D implementation has a single durable financial-operation slot, optional immutable cycle associations, lifecycle receipts, and group/cycle CAS. Its public financial services reject version 2. Existing startup installs compatibility validators; it would overwrite stricter migration rules unless stopped before initialization. Startup now performs a direct MongoDB maintenance probe **before connecting Mongoose** and refuses any database with a held migration run. Normal startup never executes migration code.

Two compatibility changes were necessary:

1. A `cycleMigration` group marker and absence predicates fence current metadata, invitation, membership, legacy financial and internal cycle writes. Group authorization returns a safe maintenance error; only an explicitly constructed internal repository adapter may read/recover under the exact matching run ID. This is not an HTTP option. Historical markers are never removed.
2. Legacy creation hashes exclude the cycle, whereas Step 3C hashes include it. Migration preserves the original hashes and adds immutable `migrationVersion: 1` plus `migrationRunId` to Cycle 1. The internal coordinator recognizes the old normalized-payload hash only when the receipt is bound to that specific provenance-bearing Cycle 1. New writes still use cycle-bound hashes and group-wide unique keys. Edited records replay as their current record; tombstones cannot resurrect. No public contract changes.

A database marker cannot fence an old binary/raw writer which ignores it. Actual shutdown of all old API instances, recurring/recovery workers, restart managers, scripts and other writers is mandatory. The migrator checks active commands but cannot prove no idle/sleeping writer will resume. The flags attest operator actions; they are not detection of process shutdown. No unrestricted force-unlock operation exists.

## Utility and CLI

The scripts do not load `.env`. Both demand an explicit URI, exact database, UUID maintenance identity and `--offline --writers-stopped --disposable`. Only names matching `tallynest_cycle_rehearsal_<13 digit timestamp>_<12 lowercase hex characters>` are accepted, only at `mongodb://127.0.0.1:27017/<same name>` without credentials, query options or alternate hosts. Default, development, production, admin and ambiguous targets are rejected. There is no real-data override flag; a future real migration requires a separately reviewed implementation and explicit operator approval.

From the repository root, against an **existing synthetic disposable fixture**:

```bash
npm run backup:cycles:rehearse --prefix backend -- \
  --uri "mongodb://127.0.0.1:27017/$CYCLE_REHEARSAL_DB" \
  --database "$CYCLE_REHEARSAL_DB" --restore-database "$CYCLE_RESTORE_DB" \
  --maintenance-id "$CYCLE_MAINTENANCE_ID" --directory "$CYCLE_BACKUP_DIR" \
  --offline --writers-stopped --disposable

npm run migration:cycles:rehearse --prefix backend -- \
  --uri "mongodb://127.0.0.1:27017/$CYCLE_REHEARSAL_DB" \
  --database "$CYCLE_REHEARSAL_DB" --maintenance-id "$CYCLE_MAINTENANCE_ID" \
  --backup-manifest "$CYCLE_BACKUP_DIR/manifest.json" \
  --offline --writers-stopped --disposable
```

The runbook explains variable setup, writer verification, backup retention, expected prerequisites and stop conditions. To generate and exercise the synthetic fixtures automatically, run `node --test integration/cycle-migration.mongo.js` from `backend`, or `npm run verify:clean` from the root. The utility is intentionally not a fixture generator or a production deployment tool.

The backup helper locates exactly one running `mongo:8.0` container publishing port 27017. It works with the repository Compose service or a matching CI service; it starts no infrastructure and fails if the tool container is ambiguous/unavailable. Docker access is required for these migration integration tests. The helper refuses a nonempty restore target without deleting it. The helper streams `mongodump --archive --gzip` through AES-256-GCM encryption to private files outside the repository, then restores into a different fresh disposable database. It compares exact BSON document digests **and** index/validator metadata, verifies the source remained unchanged during the drill, drops the restore database, and writes a private manifest. The key never appears in logs. Store its key independently for any real operational backup; colocated restricted files in the local drill are not independent key custody.

Restore uses `--stopOnError` and `--bypassDocumentValidation` only in the isolated disposable restore, so a forensic backup can preserve intentionally corrupt source fixtures exactly. It does not bypass validation in the source migration or weaken its collection rules. A matching restore digest is proof of this drill's fidelity, not proof that the source financial records are valid; reconciliation separately rejects corruption.

## Durable phases and checkpoints

`cyclemigrationruns` stores version 1, a fixed run ObjectId, the operator UUID, verified backup-manifest hash, original source digest, fixed group ID list, strict rollout group list, phase and `offlineHeld: true`. Different maintenance identities/backup manifests/versions cannot resume that run. Planning is bounded to 1,000 groups; financial documents are streamed, with write batches defaulting to 50 and capped at 100. This limit avoids unbounded metadata/validator lists; large deployment migration needs a separately reviewed scale plan.

`cyclemigrationgroups`, keyed by group ObjectId, holds the run/version, fixed Cycle 1 ID, fixed opening/freezing migration receipt IDs, baseline hashes/counts/balances, sorted member snapshot and state plan, bounded-batch cursors, recovery proof metadata, phase and optional quarantine code. Baselines contain financial metadata in the database, never raw notes or invitation tokens in reports. A fixed checkpoint is allocated with atomic insert-if-absent; concurrent workers converge on those identities. There is no expiring executor lease.

| Group phase | Durable meaning and resume behavior                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0           | Fixed checkpoint allocated; group is fenced under its run ID before processing.                                                                           |
| 1           | Legacy reservation reconciled, or absent. Original operation/target IDs and payload digest are retained when recovery was needed.                         |
| 2           | Exact post-recovery baseline, classification and cycle plan committed once.                                                                               |
| 3           | The same fixed Cycle 1 exists and validates against its plan.                                                                                             |
| 4           | All expense rows, including tombstones/receipts, carry that cycle ID.                                                                                     |
| 5           | All pending/confirmed/rejected settlement rows carry it.                                                                                                  |
| 6           | Full pre/post financial evidence matches. No group is activated if any group is quarantined in the preparation stage.                                     |
| 7           | Staged validators installed; the group's pointer, state, epoch one and version two are committed in one group write. Empty groups stay cycle-less/legacy. |
| 8           | Postchecks pass; the group marker becomes `verified`, but remains a maintenance fence.                                                                    |

The whole run stays `offlineHeld` even when every group reaches phase 8. There is no command to remove the gate or start public cycle behavior. A stop between backfill and activation leaves both protocols unavailable. A stop just after activation still leaves the maintenance gate in force. Re-running validates actual records rather than trusting phase counters alone. Cursors are evidence, not permission to skip rows: each batch searches for missing associations, so a stale checkpoint cannot hide an unmatched document.

## Preflight and staged schema rollout

Preflight requires MongoDB major version 8, expected group/expense/settlement/user collections, known strict/error-action validators, existing group-wide receipt and membership indexes, no unexpected TTL indexes, no orphan financial rows, a recognized migration version and verified backup. Known Step 3D group and dormant-cycle compatibility validators are accepted for staged installation; arbitrary drift is rejected. Required legacy indexes are not silently repaired. Dormant cycle and transition indexes are installed/rechecked idempotently before backfill; interrupted installation is recoverable.

After all preparations reconcile, the fixed set of migrated group IDs is stored. The original expense/settlement financial validators are combined with a cycle-required rule for those groups. Other legacy/quarantined groups retain compatibility shape. Verified migrated groups additionally require their protocol/pointer/state/epoch and maintenance metadata. The rules and all expected indexes are checked again after activation. Collection validators enforce local shape; they cannot enforce cross-collection foreign keys, historical immutability against privileged raw writes, or old-worker shutdown.

The permanent group marker is established with a version-aware write. Current repository mutations require it to be absent. Backfill uses raw collection writes deliberately, to add only `cycleId` despite Mongoose immutability; `_id`, timestamps, versions, split allocations, receipt hashes and audit metadata remain unchanged. It never touches personal transaction, budget or recurring schemas.

## Legacy recovery, classification and Cycle 1

Legacy recovery reuses the original actor, target, normalized payload and fixed operation ID through the existing coordinator. An offline adapter releases the reservation only if the original target's `lastFinancialOperation` proves the effect. A recoverable unknown acknowledgement never creates a second target. Missing/corrupt/irreconcilable reservations remain reserved and the group is quarantined. No reservation is cleared merely for age; no fake confirmation or payment is generated.

Classification distinguishes empty groups, open history, frozen history, known partial progress, inconsistent records and unresolved operations. A group with a conservative history marker but no remaining active expenses still receives a cycle; its permanent protection is not erased. Empty unmarked groups remain cycle-less.

Cycle 1 snapshots current registered member IDs in stable sorted order, verifies every historical creator/payer/beneficiary/sender/recipient belongs to that snapshot, and rejects missing identities. Existing shares are never recomputed. Its opening timestamp is the preserved `financialHistoryAt`; its freeze timestamp is the preserved `settlementStartedAt` when present. These are logical legacy-history anchors, not filters that exclude older expense dates. Frozen groups remain frozen, including rejected-settlement groups. Migration receipt IDs/provenance refer to the migration, not invented settlement transactions. Cycle 1 starts with version zero; the normal model permits this initial frozen legacy state.

## Exact financial reconciliation and reporting

Before association and again afterward, streaming canonical BSON digests compare every financial record excluding **only** the added cycle association. Separate evidence covers IDs, creation keys/hashes, document versions, last-operation and decision/deletion receipts, and identity sets. Reconciliation also compares:

- active and all-history expense/share totals, with tombstones counted separately;
- settlement counts by status, confirmed totals and pending reservations;
- each member's exact paid, assigned, sent, received, pending and signed net position;
- exact zero-sum conservation and safe integer boundaries.

Aggregation uses the existing group-scoped MongoDB facets before backfill and group-plus-cycle facets afterward. Integer sums remain BigInt/Decimal128-safe; no rupee floats or display rounding are involved. Unsafe all-history totals conservatively quarantine even when a displayed active subtotal would fit. A mismatch blocks activation; a late mismatch after some groups activated leaves the whole database offline for investigation.

Reports include database/migration version, offline state, group IDs, classification/phase, discrepancy codes, counts, decimal-string minor-unit totals and a digest of the complete reconciliation evidence. They omit private descriptions/notes, member profiles, invitation secrets, JWTs and full operation payloads. A successful representative fixture report has eight groups: one empty, four open-history and three frozen-history; nine expense records including one tombstone, plus one settlement in each of pending/confirmed/rejected states. Seven cycles are created, and a second run creates none.

## Test and operational boundaries

The integration suite exercises encrypted backup/restore, realistic legacy states, exact maximum amounts, original receipt replays after editing/deletion, recoverable reservations before/after insertion, irreconcilable reservations, malformed data/identities, untracked partial association, missing indexes, wrong validators, strict postchecks, maintenance write attempts, and repeated execution. Fourteen injected boundaries cover preflight, maintenance, index setup, recovery, fixed allocation, insertion, both bounded backfills, reconciliation, strict rollout, pointer activation and postverification.

Two independent OS workers operate on the same checkpoint and finish with one cycle. Another test uses actual **SIGKILL during an expense backfill batch**, then starts a fresh process, which reuses the same cycle ID and finishes the remaining documents. The raw-writer test intentionally ignores the new predicate, demonstrates that the marker alone cannot protect against old binaries, and confirms that reconciliation detects the changed record before activation.

These tests are local standalone MongoDB evidence, not Atlas failover, host power-loss, real-data migration, production backup certification or actual execution of an old compiled application binary. Quarantine has no automatic repair/force-clear interface. Future cutover requires operator approval, a verified backup, old-worker/credential isolation, rehearsal on an approved copy, reviewed runtime privilege/schema rollout and coordinated public API/frontend work.

## Files and executed verification

New implementation files:

```text
backend/scripts/rehearse-cycle-backup.js
backend/scripts/rehearse-cycle-migration.js
backend/src/config/cycle-maintenance.js
backend/src/migrations/cycle-v1/
  backup.js        # encrypted tool streams and isolated restore verification
  safety.js        # target/attestation/backup evidence gates
  preflight.js     # known validators, indexes and staged rollout definitions
  reconcile.js     # canonical BSON fingerprints and exact financial comparison
  state.js         # checkpoints, proof-bound legacy recovery, bounded backfill
  migrate.js       # versioned offline orchestration and sanitized reports
backend/tests/cycle-migration.test.js
backend/integration/cycle-migration.mongo.js
backend/integration/helpers/cycle-migration-fixture.js
backend/integration/helpers/cycle-migration-worker.js
```

Existing files changed: startup, the group/cycle models, group/invitation/membership write predicates, group authorization, internal cycle receipt matching, backend scripts, one repository-predicate test expectation, and README. No dependency versions, frontend files, personal financial schemas, CI workflows or prior design reports changed.

Executed locally on Node.js 24.21.0, standalone MongoDB 8.0.32 and Database Tools 100.19.1:

| Check                                   | Result                                                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify:clean`                  | Passed: reproducible installs, tests, lint, formatting, build, production audits and real MongoDB suites.                                                                                    |
| Backend unit/HTTP tests                 | 310 passed, zero failed/skipped.                                                                                                                                                             |
| Frontend regression tests               | 248 passed across 20 files.                                                                                                                                                                  |
| Real MongoDB integration                | 216 passed, zero failed/skipped, including 15 migration tests.                                                                                                                               |
| Targeted migration unit/integration run | 16 passed; subsequent actual CLI, migrated frozen-history/replay, and nonempty-restore refusal assertions were also executed successfully.                                                   |
| Fault/process coverage                  | Fourteen injected migration boundaries, two independent OS migrators, SIGKILL during partial backfill and fresh-process resume. Existing cycle lifecycle/freeze/recovery suites also passed. |
| Backup/restore                          | Real encrypted MongoDB archives restored into isolated disposable namespaces, with exact data and schema/index digest comparison; actual backup and migration CLI success/replay tested.     |
| Unsafe CLI destination                  | Development database name rejected with `UNSAFE_DATABASE_TARGET`, exit one, before connection.                                                                                               |
| Production audits                       | Backend and frontend each reported zero vulnerabilities.                                                                                                                                     |

The saved [sanitized reconciliation report](reports/phase-5-step-3e-reconciliation.json) was extracted from the successful clean run, not invented example data. Its eight synthetic groups all reached phase eight with matching evidence. Their seven generated legacy cycles and every source/restore database were disposable; the report's IDs are historical test identifiers. Routine output intentionally omits member balances/identities and private payloads while the database checkpoint compares their complete exact evidence. Completing an original pending operation can legitimately change pre-recovery counts/versions; the invariant baseline is captured after proof-bound recovery and the report marks `recoveredOriginalIntent` where applicable.

The root formatting command does not cover these new documentation paths, so the two Markdown documents and JSON report require the explicit Prettier check. Final `git diff --check` and those explicit formatting checks passed. Disposable source/restore databases and synthetic encrypted backup directories were checked for cleanup. The existing local development MongoDB service/volume was retained. No GitHub Actions execution, cloud migration, real-data backup, production cutover or public activation is claimed.
