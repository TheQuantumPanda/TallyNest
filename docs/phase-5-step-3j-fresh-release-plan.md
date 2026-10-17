# Phase 5, Step 3J — fresh-install settlement-cycle release plan

**Decision: NO-GO until the two implementation milestones and release gates below pass.** This plan describes a new, empty portfolio deployment. It does not authorize deployment, public activation, or conversion of an existing database. A database containing legacy, partially migrated, held, or otherwise unrecognized application state must fail closed and remain untouched.

## Recommended fresh-install architecture

Treat a fresh cycle deployment as a distinct, versioned database profile, for example `fresh-cycle-v2`. It is not a migration run and must not reuse the Step 3E held-migration marker as an activation credential. A one-time setup command, run with a setup-only MongoDB identity against a database proven to contain no collections or application data, installs the profile's validators and all indexes before the web process starts. A small schema-manifest record marks setup `initializing` and then `ready`; an interrupted setup can resume only the same profile/version after rechecking the exact partial state. Any unknown collection, data, incompatible validator, existing migration marker, or partial profile without a valid setup checkpoint is a hard stop. No setup or migration runs on ordinary startup.

Use a separate fresh-v2 validator set from the migration compatibility validator set. A fresh database has no legacy expense or settlement rows, so its expense and settlement validators can require `cycleId` for every financial record. Group validation accepts only protocol 2, valid cycle-less initial state (`cycleEpoch: 0`, no pointer/state), or a consistent post-bootstrap state. The existing migration builder remains responsible for the mixed legacy/migrated profile; do not weaken it or reinterpret its manifest as a fresh profile. Readiness must recognize exactly one profile and reject mixed, unknown, or held databases. The cycle transition journal's strict validator and unique indexes must be installed and verified before readiness can pass.

The fresh database starts with **no groups and no cycles**. Normal authenticated group creation must insert the group, the creator's sole owner membership, `financialProtocolVersion: 2`, epoch zero and the absent current-cycle pointer/state in one validated write. The client cannot supply protocol fields. The group remains cycle-less until the owner explicitly uses the existing `POST /api/groups/:groupId/cycles` first-open transition. That coordinator already requires a cycle-less v2 group, owner membership, expected group version and UUID intent, confirms no cycle or financial history, sets the permanent history marker, reserves the group operation slot, and creates one fixed Cycle 1. Do not auto-open in a GET, during group creation, or from an expense request. An expense request without an explicit cycle ID continues to fail with the staged API's `CYCLE_SELECTION_REQUIRED` contract.

Fresh v2 must use the existing group reservation, fixed operation target, checking/applying phases, immutable receipts, CAS fencing, and recovery. The permanent group history marker and settlement freeze semantics remain. A later cycle can open only after owner close of a frozen, reconciled zero-balance cycle. No implicit rollover, forgiveness, or legacy writer path is permitted.

## Current-code findings and required compatibility work

The dormant pieces are substantial, but they are not currently a normal fresh-install product path:

| Finding                                                                                                       | Evidence                                                                                                                                                                                                                                                            | Required change                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal startup uses runtime credentials to create/modify schema.                                              | `backend/server.js:48-59` calls `assertNoCycleMaintenance`, connects, then awaits user, budget, recurring, group, cycle, expense and settlement index/validator installers.                                                                                         | Move all collection/index/`collMod` work to an explicit setup command. Startup becomes read-only readiness and refuses uninitialized or incompatible profiles.                                                                                                    |
| The cycle transition journal index is deliberately absent from startup.                                       | `backend/src/repositories/group-cycle-transition.repository.js:45-65`.                                                                                                                                                                                              | Fresh setup installs its collection validator and unique indexes; readiness verifies them exactly.                                                                                                                                                                |
| Cycle API registration is test-only.                                                                          | `backend/integration/helpers/staged-cycle-app.js:18-47,73-85`; normal `backend/app.js:168-189` mounts only legacy group routes.                                                                                                                                     | Factor a normal v2 composition using the current staged controller/service/coordinators, while retaining the disposable harness. Register v2 financial routes with no catch-and-fallback to legacy writers.                                                       |
| Coordinators are opt-in and public legacy services reject v2.                                                 | `cycle-financial.service.js:51-55,125`; `cycle-lifecycle.service.js:51-73`; personal group-expense/settlement services reject a defined protocol version.                                                                                                           | Construct enabled coordinators only after fresh-profile readiness succeeds. Never enable them via request data or public config. Unknown protocol values fail closed.                                                                                             |
| Normal group creation currently inserts a legacy group.                                                       | `group.repository.js` `createForOwner()` inserts only creator/membership; `group.service.js:42-48` calls it directly. The disposable adapter at `backend/integration/helpers/cycle-fixture-groups.js:9-27` is the existing example of a single validated v2 insert. | Make ordinary creation v2 only after fresh-profile readiness; set protocol/epoch server-side in the same insert. Ensure group DTO stays compatible and omits internal protocol fields.                                                                            |
| The regular frontend has legacy Groups/GroupWorkspace routes, while the cycle workspace has a separate entry. | `frontend/src/App.jsx:26-34,76-92`; `frontend/src/cycle-test/main.jsx:1-16,30-37`.                                                                                                                                                                                  | Integrate the cycle workspace and exact v2 schemas/services into normal authenticated routes, lazy-load it, and preserve personal dashboard, transaction, budget and recurring routes. Remove legacy financial UI actions that would call incompatible endpoints. |
| Existing readiness is migration-shaped.                                                                       | `backend/src/staged/readiness.js:6-25`; `release-preflight.js` reconstructs validators from the v1 migration manifest and expects maintenance held for that report.                                                                                                 | Add a separate read-only fresh-profile checker; do not make the migration preflight accept arbitrary fresh schemas or treat `maintenance BLOCKED` as releasable.                                                                                                  |
| Staged route CORS and conditional headers are richer than normal app CORS.                                    | `staged-cycle-app.js:56-70` allows `If-Group-Match`, `If-Cycle-Match` and exposes `X-Group-ETag`; `app.js:61-68` does not.                                                                                                                                          | Add only the exact headers needed by v2 and verify preflight/ETag behavior in the production composition.                                                                                                                                                         |
| The existing v2 invitation predicate permits version-2 admission only when the current cycle is closed.       | `backend/src/repositories/invitation.repository.js:79-82`.                                                                                                                                                                                                          | Preserve this boundary and verify invitation acceptance, membership snapshot and next-cycle roster behavior end to end.                                                                                                                                           |

The current mixed-profile and migration tools remain valuable for later legacy conversion. They must not be changed to accept arbitrary database targets as part of fresh activation.

## Implementation milestones

Two reviewable milestones are sufficient.

### Milestone 1 — fresh-v2 schema, group creation and read-only boot gate

Likely files:

- `backend/src/models/*` and validator builders for a named fresh-v2 profile (groups, cycles, transition journal, expenses, settlements, and schema manifest).
- `backend/src/repositories/*` setup/readiness helpers; transition journal index installation.
- New explicit `backend/scripts/setup-fresh-cycle-schema.js` and a root/backend npm command. It accepts a target only through a restrictive local disposable namespace in automated tests; a future real fresh deployment requires explicit operator confirmation, a fully qualified target, and the same exact empty-target proof. It rejects known development/shared persistent targets and every nonempty/unknown database. No production migration option is added.
- `backend/server.js` startup changes: connect with runtime identity, run bounded read-only profile/index/validator/maintenance checks, then construct the server. No `ensure*Indexes`, `collMod`, auto-repair, migration, or marker release under runtime credentials.
- `backend/src/repositories/group.repository.js` and group service tests for atomic v2 group/owner insertion.
- Readiness and database integration tests, including interrupted setup, dirty DB refusal, wrong/weak validator, missing index, transition index, migration-hold rejection, and first Cycle 1 bootstrap.

Required design detail: the setup command must prove emptiness before installing the first application collection. No API, recurring worker or other writer may connect until the manifest is `ready`; do not hand runtime credentials to old binaries. If setup crashes after starting, only its exact schema-manifest checkpoint may resume installation; it must compare all partially installed metadata with the intended profile and stop on unexplained drift. “No groups found” alone is not proof of a fresh database. Setup credentials should be revoked or removed after completion. Runtime needs only required reads/writes and read access to readiness markers, not `createCollection`, `createIndexes`, `collMod`, or database administration.

Acceptance: fresh disposable DB installs exactly; restart with runtime-only credentials passes read-only readiness; missing permission or schema drift fails before listening; all new groups are v2 and cycle-less; first explicit open produces exactly one Cycle 1; failed/unknown open is recovered only through the original reservation; existing staged and legacy financial tests remain unchanged; no v2 group can reach a legacy financial writer.

### Milestone 2 — normal v2 API/UI composition and release rehearsal

Likely files:

- `backend/app.js`, a v2 group financial route composition module, and `backend/src/staged/*` or a carefully renamed reusable API layer. Keep the disposable integration composition as a test adapter; the production app must not import test fixtures or fault hooks.
- `backend/src/routes/group.routes.js` and group/financial service wiring to ensure a v2 group is served only by v2 financial endpoints, with no fallback after protocol/readiness/authorization errors. Legacy group APIs remain for the separately supported legacy profile only; the fresh profile must contain no legacy groups, and startup fails if it does.
- `frontend/src/App.jsx`, `frontend/src/pages/GroupWorkspace.jsx`, `frontend/src/pages/CycleWorkspace.jsx`, group navigation, and cycle/group services. Integrate the strict `apiVersion: 2` DTOs, ETags, `If-Group-Match`/`If-Cycle-Match`, UUID intents, scoped cursors, uncertainty recovery, invitation boundary and no-store behavior. Preserve personal routes and tests.
- Backend HTTP tests, disposable standalone MongoDB end-to-end tests, production-build route/bundle assertions, and Chromium workflows for account/group creation, invitations, two successive cycles, exact balances, settlement freeze/close, recovery and personal-finance isolation.

Acceptance: normal startup registers v2 routes only when fresh-v2 readiness passes and cannot be toggled by URL/header/body or browser storage; a protocol mismatch returns a sanitized fail-closed error without trying the legacy writer. Normal app creates fresh-v2 groups; no group is implicitly upgraded. The frontend has one integrated group experience while personal pages remain available. The full verification and hosted smoke gates below pass.

## Readiness, permissions and deployment boundary

Use two database identities and two commands:

1. **Schema setup identity:** only during explicit first-time setup, scoped to the target database; it can create approved collections/indexes and apply exact validators (`createCollection`, `createIndex`, `collMod`) and write the setup manifest. It is not used by Express. Retire/rotate it after setup. Automated tests accept only a uniquely named disposable namespace. A future real fresh deployment may use its explicitly identified new database after operator confirmation and the same strict empty-target proof; setup must reject known development/shared persistent targets and must not offer a migration mode.
2. **Runtime identity:** least-privilege application CRUD plus the reads/writes needed for protocol reservations, receipts, auth, recurring work, and bounded readiness metadata. It cannot create indexes/collections or run `collMod`. It cannot write migration checkpoints or release maintenance. Verify actual MongoDB/Atlas role behavior before choosing grants; do not grant `dbAdmin`/cluster-admin simply to make startup pass.

Readiness is a read-only startup gate, not a financial lock. It must verify exact schema profile/version; strict validator structure, action and level; every required unique/partial/history/receipt index including no TTL on durable receipts; transition journal indexes; absence of database-wide migration maintenance; no unsupported legacy/mixed protocol groups; and cycle pointer/epoch/state/association consistency. It may perform bounded document probes at startup and report sanitized codes/counts only. An unresolved operation is a per-group busy/recovery state, not grounds to disable the only recovery path: startup must allow authentication and the existing authorized fixed-intent recovery flow while all ordinary writes for that group remain blocked. Database-wide maintenance still blocks service. Full history/financial reconciliation remains an offline/maintenance check and must not run on every request or be replaced by cached success. CAS, group reservation, authorization and recovery predicates remain authoritative on each write.

The environment loader currently requires `MONGO_URI`, `JWT_SECRET`, `JWT_TTL_SECONDS` and `CLIENT_ORIGIN`, enforces HTTPS `CLIENT_ORIGIN` in production, and the auth cookie is HttpOnly, Secure in production and SameSite=Lax (`backend/src/config/env.js`, `backend/app.js:74-85`). The simplest deployment is same-origin API routing: serve the React SPA and reverse-proxy `/api/*` to Express while preserving the browser's HTTPS origin. This fits the current production Axios default `/api`, host-only `__Host-sfm_access` cookie and Lax policy. If using separate sites, do not assume cookie behavior; a coordinated CORS and `SameSite=None; Secure` change would need separate review and browser verification. Verify TLS termination, trusted proxy behavior, forwarded protocol, cookie Domain/path (keep `__Host-` requirements), exact `CLIENT_ORIGIN`, credentials, OPTIONS, CSRF header and Origin rejection on the actual host. Do not broaden CORS with wildcards.

Before release, also verify:

- Same-origin `/api` proxy, SPA history fallback for `/app/*`, no secrets in Vite `VITE_*` values, and no cache on private cycle responses.
- Per-user rate limits on v2 routes and invitation inspect/accept; rate limits survive proxying with correct client IP handling. Trust-proxy configuration must be minimal and tested, not a blanket trust of spoofable forwarded headers.
- Invitation raw tokens appear only in initial creation responses and never in routine logs, analytics, referrers, traces or proxy access logs. Use `Referrer-Policy: no-referrer` on token routes/pages; avoid third-party resources on invitation landing pages.
- Session cookies are HttpOnly; registration/login/logout, CSRF rejection, session expiry and cross-account isolation are tested in Chromium on hosted HTTPS. No JWT or financial draft storage is introduced.
- Recurring processing remains catch-up/best effort after host sleep; the release must not promise exact execution time. Start/recovery workers only after schema readiness and coordinated startup.

## Backups and recovery

A truly empty first-install database has no prior customer financial state to cut over; a migration backup is not a precondition to initial schema installation. Before accepting real user records, require an independently retained encrypted backup, separately recoverable encryption key, documented retention/restore owner, and a successful isolated restore that verifies document counts, validators, indexes and a financial reconciliation. Use the existing rehearsal tooling only for its explicitly synthetic target; do not point it at a future portfolio database. Choose and test the hosting provider's supported backup method without placing dumps or keys in Git, shell history or application logs. For each future application release that changes validators/indexes, rehearse backup/restore and rollback on a disposable copy.

After financial writes begin, restoring an old backup can lose acknowledged transactions, expenses, settlement receipts, tombstones, or idempotency keys. Rollback then requires stopping writers and a separately reviewed forward-recovery/reconciliation plan; never downgrade binaries and discard later records. Keep applying reservations blocked until fixed-target recovery proves the effect. No setup/preflight command may clear them.

## GitHub Actions, MongoDB, browser and hosted gates

Required before a fresh-v2 release:

1. GitHub Actions on PRs to and pushes to `main`, Node 24, reproducible `npm ci`, standalone MongoDB 8.0 service, and the root `npm run verify:clean` gate. CI must test the fresh profile in uniquely named disposable DBs, prove cleanup, and test that normal production composition has no accidental setup/migration route or browser-controlled activation. Pin actions according to existing workflow policy. Do not place real JWT/MongoDB credentials in CI.
2. Real local MongoDB integration: setup from a completely empty disposable DB; exact validators/indexes; restart using a runtime identity lacking schema-admin rights; dirty/legacy/partial DB refusal with unchanged digests; group owner creation; explicit Cycle 1 open; expense and settlement lifecycle/recovery; duplicate/idempotency and concurrent CAS; cleanup. Mocks alone do not verify the MongoDB invariants.
3. Chromium against the normal app composition and disposable MongoDB: registration/login/session restore, group creation, first cycle, two cycles, invitations at closed boundary, split methods, freeze/close/open, permission/errors/ETags/recovery, personal finance isolation, desktop/mobile and 320px. Assert no staged-only harness is needed and no legacy UI action is sent to legacy financial services.
4. Hosted smoke gate before public announcement: a disposable account and disposable group on the exact HTTPS frontend/API topology; verify cookie flags, Origin/CSRF, `/api` routing, rate limits, invitation secrecy, SPA hard reload, session expiry, recovery and one end-to-end cycle. Verify hosted logs contain no secrets. Do not use production customer data for smoke tests.

Current `npm run verify:clean` runs unit/HTTP, lint/format, build, production audits and MongoDB integration. `npm run verify:browser` is a separate local Chromium suite. Neither CI workflow nor prior local verification proves hosted HTTPS, Atlas role grants, sleeping-host startup, or Vercel/proxy behavior; keep these as explicit release gates.

## Blockers and deferred scope

### Mandatory blockers for fresh-install release

- No approved `fresh-cycle-v2` schema profile/setup tool; current startup performs schema mutations with runtime credentials.
- No normal app route composition for the staged v2 API, no normal frontend cycle workspace, and normal group creation still creates a legacy group.
- No exact fresh-profile readiness gate or transition-journal index installation in normal startup.
- Route protocol dispatch has not been implemented and demonstrated to be fail-closed with no legacy fallback.
- Current ordinary group creation and management have not been tested against v2 protocol semantics and strict v2 DTOs.
- No full normal-composition real MongoDB + Chromium verification or hosted HTTPS smoke test.
- No verified production runtime role that is read-only for schema and still supports all required financial writes/recovery.

### Necessary operational protections

- Separate and revoke setup credentials; record exact schema version and code revision.
- Reject nonempty, legacy, migration-held and partially initialized databases without changing them.
- Before real user data, independently verify encrypted backup restore and key recovery.
- Preserve old-writer fencing for future migration scenarios; a database marker cannot stop an old binary that ignores it.
- Provide sanitized logs, no-store private responses, correct reverse-proxy trust, and operational monitoring for unresolved reservations.

### Optional improvements

- A focused operator dashboard for read-only schema/version status (must not offer repair/unlock).
- More granular runtime roles if Atlas grants support them cleanly; document tested minimum permissions.
- Scheduled backup automation and recovery-point objectives after a provider is selected.
- Separate deployment smoke account lifecycle automation.

### Deferred legacy migration responsibilities

The Step 3E offline migrator remains synthetic-only and held. Real legacy migration, mixed-protocol operation, migration maintenance release, old-binary/credential fencing, per-group quarantine resolution and any production-target CLI remain deferred. A nonempty legacy database is **not** made fresh by adding v2 fields or by deleting collections/markers. It needs a separate approved migration and rollback design; absent that, deployment must point to a genuinely new empty database.

## Release NO-GO conditions

Do not release if setup sees any unexpected collection/document, migration marker, legacy group, partially installed schema, nonexact validator/index, missing unique receipt/active-slot/journal index, unexpected TTL receipt index, unresolved operation, group/cycle pointer mismatch, unsupported runtime permission, public path to a legacy financial writer for v2 data, client-controlled protocol switch, missing/incorrect ETag or idempotency behavior, personal/group financial cross-contamination, insecure hosted cookie/Origin behavior, failed restore proof before real data, or any failed required CI/Mongo/Chromium/hosted gate. Preflight PASS only means inspected constraints match; it never authorizes data repair or maintenance release.

## Estimated remaining work and shortest safe path

The shortest safe route is: **(1)** implement the fresh-only schema installer and read-only least-privilege startup gate, make new groups atomically v2/cycle-less, and pass MongoDB setup/recovery/dirty-target tests; **(2)** integrate the existing v2 API and cycle workspace into normal authenticated compositions with no fallback, then pass CI, Chromium and hosted smoke gates. Keep the migration tool unchanged and out of the fresh path.

Estimate: approximately **4–7 focused engineering days** for the two implementation milestones and local gates, plus **1–2 days of deployment/backup/hosted verification** once a hosting topology and credentials are available. This is a planning estimate, not a measured commitment; actual Atlas role constraints or a discovered route compatibility defect can extend it. No runtime or operational change is performed by this document.
