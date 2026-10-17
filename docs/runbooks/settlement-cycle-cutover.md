# Settlement-cycle offline cutover runbook

**Current authorization:** synthetic disposable local rehearsal only. The checked-in utility rejects real database names and remote/authenticated URIs. No real-data migration, backup, deployment, public cycle activation or maintenance release is authorized by this runbook alone. A future real cutover needs explicit operator approval and a separately reviewed implementation that can address the real target safely.

## 1. Preparation and stop conditions

Record the responsible operator/reviewer, source database identity, exact commit, Node/MongoDB/Database Tools versions, maintenance UUID, writer inventory, backup/restore evidence and reconciliation report location. Use a dedicated maintenance OS account/database identity for future operations. No secrets or dumps belong in Git, tickets, chat logs or shell history.

Stop if the target is ambiguous, any writer cannot be accounted for, a backup cannot be restored, schemas/indexes drift unexpectedly, identities are missing, a reservation cannot be reconciled, or any monetary/receipt/version evidence differs. Do not remove lock predicates or collection validation to get past an error. Do not clear applying reservations or delete quarantined checkpoints.

A database flag does not stop a pre-upgrade binary or privileged raw script. Before taking a consistent standalone backup, actually stop every API instance, background recurring job, financial recovery worker, one-off script, scheduled task and restart manager. Scale down/disable host auto-restart and scheduled invocations as applicable. Verify process/container/service inventories, listening ports and database connections; retain redacted evidence. For local inspection, `ps`, `ss -ltnp` and `docker ps` are useful, but their absence of a matching process is not proof about another machine. On a future hosted system, verify **all** instances and restrict/revoke runtime write credentials or network access while retaining the separate maintenance identity. No cloud shutdown is executed in this milestone.

The migrator's active-command check is a supplementary signal. An idle connection or sleeping server can write later; `--writers-stopped` is an operator attestation, not an automatic proof. The checked-in startup guard protects only binaries that contain it.

## 2. Disposable services and target setup

Prerequisites: Node.js 24, installed package dependencies, Docker access, and exactly one `mongo:8.0` container publishing port 27017. The backup helper uses the Database Tools inside that container, avoiding an additional host package dependency. No paid service is needed.

```bash
docker compose up -d --wait mongodb
npm run install:ci
```

Use the automated fixture/drill rather than copying development financial records:

```bash
cd backend
node --test integration/cycle-migration.mongo.js
```

The suite creates uniquely named synthetic databases and registered test identities; it drops source/restore databases and removes temporary encrypted backup directories. It also exercises actual process termination and restart. Never relabel a development database as a disposable database to bypass the name restriction.

For a separately prepared **synthetic** fixture, set explicit variables from the repository root:

```bash
umask 077
CYCLE_REHEARSAL_DB='tallynest_cycle_rehearsal_<13-digit-timestamp>_<12-hex-suffix>'
CYCLE_RESTORE_DB='tallynest_cycle_rehearsal_<different-timestamp>_<different-12-hex-suffix>'
CYCLE_MAINTENANCE_ID='<fresh-UUID-retained-for-this-run>'
CYCLE_BACKUP_DIR='<absolute-private-directory-outside-the-repository>'
```

These are deliberate placeholders; commands reject them until replaced with valid explicit values. The source must already contain the expected collections, required receipt indexes and approved legacy validators. The utility does not silently bootstrap a missing application schema. Do not copy a real `.env` or production credential into these commands; rehearsal accepts only the exact local credential-free URI.

## 3. Backup creation, encryption and restore drill

With writers stopped:

```bash
npm run backup:cycles:rehearse --prefix backend -- \
  --uri "mongodb://127.0.0.1:27017/$CYCLE_REHEARSAL_DB" \
  --database "$CYCLE_REHEARSAL_DB" --restore-database "$CYCLE_RESTORE_DB" \
  --maintenance-id "$CYCLE_MAINTENANCE_ID" --directory "$CYCLE_BACKUP_DIR" \
  --offline --writers-stopped --disposable
```

The helper streams a gzip MongoDB archive through Node AES-256-GCM into `backup.enc`, creates a random 256-bit key in `backup.key`, and writes `manifest.json` only after restore succeeds. Files are mode 0600 in a private directory; plaintext BSON is not written to disk. Keep the encryption key separate from encrypted archives for any real operational retention, with restricted offline/independently recoverable custody. The local test deliberately keeps both in one private temporary directory and does not claim independent key custody or an off-machine backup.

The temporary restore is a distinct, empty, explicitly named disposable namespace. The helper uses namespace remapping, authenticated decryption, `--stopOnError`, and compares document plus schema/index digests with the source. It checks that the source stayed unchanged during the drill and drops the restore database. It uses `--bypassDocumentValidation` **only on that isolated forensic restore**, so deliberately corrupt test data is preserved for diagnosis instead of silently omitted. Source financial validation is never bypassed. Do not connect an application to such a forensic restore until financial preflight passes.

MongoDB documents archive input, namespace remapping and the restore flags in its [Database Tools reference](https://www.mongodb.com/docs/database-tools/mongorestore/). In particular, default restore behavior can continue past some document errors; this helper explicitly requests stop-on-error. Tool exit status alone is insufficient; the content and schema comparisons must match.

Treat the private manifest as local operator evidence tied to its encrypted archive, not a signed attestation against a malicious administrator. Retain archive checksum, source/restore digests, tool versions and the successful drill report. Test key recovery independently before approving any future real backup. The current helper fails if a backup key/archive/manifest already exists or the private directory/file permissions are unsafe; do not overwrite an older backup.

## 4. Preflight and migration order

```bash
npm run migration:cycles:rehearse --prefix backend -- \
  --uri "mongodb://127.0.0.1:27017/$CYCLE_REHEARSAL_DB" \
  --database "$CYCLE_REHEARSAL_DB" --maintenance-id "$CYCLE_MAINTENANCE_ID" \
  --backup-manifest "$CYCLE_BACKUP_DIR/manifest.json" \
  --offline --writers-stopped --disposable
```

Capture JSON output in a private report file if required. Exit zero means every group reconciled and verified under maintenance; exit two means quarantined/incomplete groups; exit one means a safety/preflight/interruption failure. Raw driver errors and payloads are not printed.

Execution order:

1. Verify local target, backup evidence, MongoDB 8, known schemas, required legacy unique indexes, active commands and source digest.
2. Write the durable database maintenance run and install the known compatibility marker schema. Current startup now refuses this database before Mongoose can replace staged validators.
3. Fence each group; reconcile original legacy reservations through fixed IDs and effect receipts. Never clear an unproved effect.
4. Classify and allocate fixed Cycle 1/snapshot/migration receipts. Empty unmarked groups remain cycle-less. Any exception quarantines the group and blocks preparation-stage activation for the whole run.
5. Create the planned open/frozen cycle; backfill every expense/tombstone and settlement in bounded batches, preserving IDs, versions, timestamps, hashes and audit metadata.
6. Compare complete canonical record evidence, identity sets, receipt/version sets, exact totals and member balances.
7. Install strict cycle-required financial rules for the fixed migrated group list; verify indexes and validators. Activate pointer/state/epoch/protocol fields in each group atomically, keeping its maintenance gate held.
8. Verify pointer/cycle consistency, internal exact read results and unchanged evidence; mark groups verified. The database stays offline.

The application runtime should eventually need only approved collection CRUD/read privileges and maintenance-marker read access. Migration/setup additionally needs collection/index creation, `collMod`, metadata inspection and active-command inspection. Backup/forensic restore needs its own scoped read/restore privileges, including validation bypass **on the disposable restore only**. Actual Atlas grants and least-privilege startup changes remain unverified; do not grant broad cluster administration to the normal web process to bypass a permission error.

## 5. Interrupted runs and quarantine

Keep all writers stopped and retain the **same** database, maintenance UUID, migration version, backup files and manifest. Re-run the exact command. Do not generate a new UUID or delete checkpoints. The migrator reuses fixed cycle and operation IDs, rechecks stored baselines, retries only missing associations, completes partial validator rollout and reconciles a committed pointer even if its acknowledgement was lost.

A group with a corrupt/unresolved operation stays reserved/quarantined. Preserve its original source and migration metadata; capture only the group ID/discrepancy code in routine logs. An authorized operator must investigate against the backup or an isolated copy. There is no force-unlock or automatic quarantine-reset command. A new run identity cannot override the old one. If privileged raw writes occurred during maintenance, stop and review the entire cutover rather than trusting the next retry.

Real tests cover SIGKILL after one document of a backfill batch and fresh-process resume, two concurrent migration processes, index/validator interruptions and late activation interruptions. This is not an Atlas failover or network-partition test.

## 6. Reconciliation sign-off and readiness

Require every group report to be verified with no discrepancy. Review classifications: every legacy `settlementStartedAt` group must map to frozen Cycle 1. Pending capacity, confirmed amounts, rejected records, tombstones and creation keys must survive. Original group/member/creator IDs, markers, metadata, financial versions and audit fields must match, except legitimate completion of an already-reserved fixed operation. No balances are forgiven or rolled over.

Verify strict validators and unique indexes after the final stage, no residual `financialOperation`, matching pointer/state/epoch, and identical source/target reconciliation evidence. Legacy services must reject migrated groups; controlled internal reads may inspect them using the exact offline run adapter. Normal version-2 mutations are still blocked by maintenance. Check personal finance isolation and run the complete regression gate:

The approved **read-only disposable inspection sequence** after the migration rehearsal is:

```bash
npm run preflight:cycles:rehearsal --prefix backend -- \
  --database "$CYCLE_REHEARSAL_DB"
```

Exit 2 with `schema`, `indexes`, `migration`, `associations` and `reservations` at `PASS`, while `maintenance` and overall status remain `BLOCKED`, is the expected held-database result. Exit 1 or any `FAIL` requires investigation and no release. The CLI accepts only a uniquely named local disposable rehearsal database, constructs a read-only Mongoose connection (`autoCreate` and `autoIndex` disabled), and does not accept an arbitrary URI. It does not release a marker. Compare its sanitized report with the migrator's reconciliation report and the independently retained encrypted backup/restore evidence. Record the code revision and report privately; do not treat the marker's backup hash alone as proof that an independent backup remains recoverable. See [Step 3I](../phase-5-step-3i.md) for the exact strict-validator reconstruction and drift checks.

Before a future real-data release is even designed, explicitly verify that old API, recurring and recovery workers are stopped **and cannot reconnect** with old write credentials or network paths; an attestation or idle connection scan is insufficient. Approve exact migration checkpoints and group set, validator/index metadata, no applying reservations, new-binary/frontend contract match, runtime read/write privileges, hosted HTTPS cookie/Origin behavior, backup key custody and restore proof, and a rollback decision point. The current `server.js` still runs collection/index/`collMod` setup under runtime credentials and does not install the transition-journal index; it is not the future least-privilege cycle startup. No maintenance-release command exists, and this read-only preflight is not one.

```bash
npm run verify:clean
npm exec --prefix frontend -- prettier --config frontend/.prettierrc.json --check \
  docs/phase-5-step-3e.md docs/runbooks/settlement-cycle-cutover.md
git diff --check
```

**Do not restart an application on a held rehearsal database.** Current startup intentionally refuses it, and there is no release command. Before a future real activation, separately approve public API/DTO/frontend compatibility, maintenance release, new-binary-only startup, validator/index preflight under runtime credentials, backups/restore acceptance and a monitored rollback decision point. Stop old binaries and invalidate their ability to reconnect before that cutover. No deployment occurs here.

## 7. Rollback and backup retention

Before any new cycle financial activity, a future approved rollback can restore the complete verified pre-cutover backup into an isolated database, reconcile it, recover original pending intents with their fixed IDs, and switch only after explicit operator approval. Restore the correct historical validator/index/binary combination together. Do not manually unset cycle fields, copy only some collections, or remove history markers. A partially migrated source remains offline while the restored copy is reviewed.

After new cycle writes or settlement decisions have occurred, restoring an older backup can erase valid financial history and acknowledged settlements. That is no longer a routine rollback: use forward recovery or a separately reviewed repair preserving every later receipt and record. Do not downgrade binaries merely because the old UI renders.

For this milestone, cleanup is limited to exact disposable source/restore namespaces and their private synthetic backup files. Never use an unconstrained database-drop command or remove the repository's MongoDB volume. Retain future real backups according to an independently approved encrypted retention and key-recovery policy; this rehearsal implements no production retention automation.
