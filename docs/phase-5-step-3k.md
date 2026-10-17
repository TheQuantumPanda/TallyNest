# Phase 5, Step 3K — fresh-v2 schema and startup

**Status: Milestone 1 foundation; public settlement cycles remain NO-GO.** Normal Express startup now requires a fully installed fresh-v2 schema and creates new groups with protocol 2 and epoch zero. The normal router and React application still use legacy group financial contracts, which reject v2 groups. The cycle lifecycle and write coordinators remain available only to controlled internal fixtures. No production database setup command, public cycle route, migration, or deployment is included.

## Schema profile and manifest

`backend/src/config/fresh-cycle-schema.js` defines the named `fresh-cycle-v2` profile, version 1. It covers users, personal transactions, budgets, recurring schedules, groups, cycles, shared expenses, settlements, and transition journals. Each collection has an exact strict/error validator and the required model indexes. Personal money fields require positive safe integer minor units at the database validator; existing application-level cross-field validation remains authoritative. Fresh groups require protocol 2 and epoch zero without a current pointer, or a valid pointed state. The fresh expense and settlement validators require `cycleId`. Cycle sequence, active-slot partial uniqueness, group-wide creation receipts, and unique transition intents retain their existing indexes. The installer and readiness checker reject unexpected indexes and any TTL index on these collections. The mixed legacy/migration validators remain unchanged.

`freshschemamanifests` contains one strict record (`tallynest-fresh-cycle-v2`) with profile, version, `initializing|ready` state, and a collection checkpoint. The installer creates the manifest first. After each collection's exact validator and indexes are verified, it advances the checkpoint by CAS. A restart checks every completed collection and allows only a known partial next collection with an exact validator and a subset of approved indexes. It rejects unknown collections, documents without the manifest, mismatched checkpoints, drift, and unsupported versions. An interrupted pre-manifest insert may resume only when the exact empty manifest collection is the sole collection. It never rewrites finance documents or removes a maintenance marker.

## Explicit local setup and startup

The only checked-in setup CLI accepts a uniquely named local disposable namespace matching `tallynest_fresh_v2_test_<13-digit timestamp>_<12 lowercase hex>`. It connects only to `127.0.0.1:27017` without credentials:

```bash
docker compose up -d --wait mongodb
npm run setup:cycles:fresh:test --prefix backend -- \
  --database tallynest_fresh_v2_test_<timestamp>_<hex>
```

Replace both placeholders with a genuinely new random name. Set backend `MONGO_URI` to that exact disposable database to run the normal server locally. Existing `.env` files are not rewritten by setup. A later real fresh deployment requires a separately reviewed operator interface; changing a development or production database name to match this test pattern is prohibited.

`backend/server.js` connects with Mongoose `autoCreate` and `autoIndex` disabled, calls the read-only `assertFreshCycleReadiness`, and listens only after it passes. Normal startup no longer calls collection/index installers or `collMod`. It rejects an uninitialized, legacy, mixed, partially installed, migration-held, or drifted database. Existing local databases that relied on implicit startup setup will no longer boot through `server.js`; keep them untouched. Existing unit and standalone MongoDB integration fixtures still construct their own schemas. The old test-only cycle browser server retains its own disposable setup.

Readiness checks the exact manifest, all collection validators and indexes, absence of database-wide migration metadata and legacy groups, cycle associations, and group pointer/epoch/state agreement. It does not write or repair anything. A group with an unresolved reservation remains blocked for ordinary financial actions, while the application can start so the original fixed-intent authorized recovery remains possible through the internal protocol. The normal public recovery route remains legacy-only until Milestone 2; it must not be used to clear a v2 reservation. This is a deliberate availability limitation before activation.

## Group creation and authorization boundary

After startup readiness, `server.js` constructs the normal app with fresh-v2 group creation. `createForOwnerV2` validates and inserts the group, creator's owner membership, protocol version 2, epoch zero, and no current cycle pointer/state in one document write. Input validation rejects client-provided owner, protocol, epoch, IDs, versions, and MongoDB operators. The response retains the existing sanitized group DTO. No cycle is opened implicitly.

Only the existing `createCycleLifecycleService.openFirst` coordinator can establish Cycle 1, using an owner-authorized UUID intent, group version, the single group reservation, a fixed target ID and journal, and its recovery protocol. This milestone does not expose that action through normal HTTP. Existing normal `/api/groups/:id/expenses`, settlements, balances, and financial recovery remain legacy services; they reject v2 groups with `CYCLE_PROTOCOL_INACTIVE`. `/api/groups/:id/cycles` remains absent. The standard group workspace is therefore intentionally limited for fresh-v2 groups until Milestone 2.

## Runtime permissions and MongoDB proof

The auth-enabled standalone MongoDB integration test used a separate disposable container and database. A setup identity with `dbOwner` installed the exact schema. The runtime identity had database-wide `find`, `listCollections`, and `listIndexes`, plus `insert`, `update`, and `remove` on **named application collections only**. The runtime identity passed readiness, created a registered user and fresh-v2 group, reserved an interrupted first-cycle operation, and recovered its original fixed target. MongoDB denied its attempts to create an unrelated collection, create an index, and run `collMod` (error code 13). An even narrower identity without metadata privileges could not pass readiness. Broad database-wide write grants are inappropriate because they can permit implicit collection creation.

These are local MongoDB 8.0 results, not proof of Atlas role behavior. Runtime grants must be reviewed on the eventual host. Setup credentials must never be used by the web process, and only the installer may create schema. A schema readiness PASS is inspection evidence, not a substitute for write-time CAS, authorization, immutable receipts, or exact financial validation.

## Negative coverage and compatibility

Disposable tests exercise stops after manifest collection creation, manifest insert, collection creation, index completion, checkpoint update, and final ready state; each resumes the same profile. They reject unknown collections, a nonempty legacy-shaped target, migration markers, a forged checkpoint, weakened expense validation, missing unique creation receipt, incorrect active-slot filter, missing transition journal index, and unsupported profile version. Tests verify normal HTTP rejects protocol fields, creates a v2 group, exposes no cycle route, and denies legacy balances. Direct internal lifecycle tests verify identical UUID replay and a new-key stale-version result. A checking-phase interruption leaves a recoverable reservation without disabling schema readiness.

The existing migration rehearsal and mixed-validator profile are unchanged. No existing database is treated as fresh merely because it lacks groups. The current startup gate rejects it unless the entire schema and manifest match. Existing group invitation rules continue to admit version-2 members only at the closed-cycle boundary; before Cycle 1, joining is not yet supported by the normal experience. No personal finance data is modified.

## Verification and remaining work

On 2026-10-17, `npm run verify:clean` passed with 314 backend tests, 265 frontend tests, and 266 real MongoDB integration tests. Its ESLint, configured Prettier, production frontend build, and both production dependency audits passed; the audits found zero production vulnerabilities. The targeted fresh-schema suite passed 10 real MongoDB tests, including an auth-enabled runtime-grant scenario. `npm run verify:browser` passed three Chromium tests and verified its disposable database cleanup. The standard Chromium fixture required no source adaptation because it constructs its own staged server and database. Browser success does not imply normal cycle activation.

Earlier parallel integration runs failed after the local MongoDB container exhausted its 2,048-file-descriptor limit and restarted. The `test:mongo` command now runs integration files serially; the completed clean run had no MongoDB restart. This is a local Docker verification constraint, not a financial protocol change. One namespace left by an aborted run was explicitly removed. Two older `tallynest_cycle_http_test_*` databases predated this task and were left untouched. Atlas, hosted HTTPS, and production setup privileges were not tested.

Milestone 2 must register the v2 HTTP composition in normal Express after readiness, route v2 groups exclusively to v2 financial services, expose the authorized recovery path, integrate the strict cycle workspace and conditional headers into the normal React app, and complete end-to-end browser and hosted security checks. A separate operator-reviewed production fresh-setup interface, backup/restore proof, and hosted runtime grants remain release prerequisites. Legacy migration and held-database release remain separate future work.
