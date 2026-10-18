# Phase 5, Step 3L — normal application integration

## Scope and result

The normal Express server now constructs the version-2 group financial API only
after the read-only fresh-v2 schema readiness gate succeeds. The regular
authenticated group route now opens the lazy cycle workspace. Personal dashboard,
transactions, budgets and recurring routes remain in the same application. This
is a local fresh-install integration, not a legacy migration or hosted release.

The fresh-v2 installer remains restricted to uniquely named local disposable
databases matching `tallynest_fresh_v2_test_<13-digit timestamp>_<12 hex>`.
No setup step alters `.env` or an existing database. Normal startup does not
install indexes, modify validators, repair schema, or release a maintenance hold.

## Backend composition

`backend/server.js` connects with automatic collection/index creation disabled,
runs `assertFreshCycleReadiness`, and only then constructs
`createCycleHttpComposition` and passes its routes to `createApp`. Failure of the
schema gate prevents the HTTP listener from starting. The cycle router is mounted
before legacy `/api/groups` routes. It handles cycle, cycle-scoped expense,
settlement, balance and recovery paths directly; errors flow to the shared error
handler and never fall through to a legacy financial writer.

The regular `createApp()` factory still has no cycle routes by default. There is
no request-controlled protocol switch. The server composition selects v2 based
on its trusted startup readiness result, not request fields, cookies, URL
parameters, headers, frontend storage or public environment flags. The disposable
fixture app remains separate and is not imported by normal startup.

Normal authenticated group creation uses `createForOwnerV2`: the group,
authenticated creator's sole owner membership, protocol version 2 and epoch zero
are inserted in one validated document write. The group is cycle-less until the
owner explicitly opens Cycle 1 through the existing lifecycle coordinator. No
legacy group or historical record is upgraded.

The staged router has been moved to the reusable route module
`backend/src/routes/cycle.routes.js`; the staged import remains as a compatibility
re-export. It retains strict `apiVersion: 2` envelopes, resource ETags,
`X-Group-ETag`, CSRF and exact Origin checks, authentication, bounded per-user
rate limiting, signed list cursors and `Cache-Control: no-store`. CORS explicitly
allows `If-Group-Match` and `If-Cycle-Match` and exposes the group ETag. Production
cookie naming and security options remain the existing authentication behavior.

The v2 service rejects non-v2 groups and group-level migration holds. It resolves
creation receipts before selecting an active cycle, so an old request cannot
land in a later cycle. New creations require explicit cycle scope; record
mutations remain attached to the record's cycle. There is no catch-and-retry via
legacy transaction writers. An unresolved group operation blocks ordinary
financial mutation while the authenticated original actor/owner recovery route
remains available through the original fixed-intent protocol.

Normal group metadata, roster and invitation routes continue using the existing
services and database predicates. Invitation admission remains permitted only at
the closed-cycle boundary. As a result, a new cycle-less group first needs an
empty cycle explicitly opened, frozen and closed before it can admit an invitee;
opening the next cycle then snapshots the updated membership. Member departure,
owner succession, settlement corrections and implicit rollover remain
unsupported.

## Frontend integration

`frontend/src/App.jsx` routes both `/app/groups/:groupId` and
`/app/groups/:groupId/cycles/:cycleId` to the same lazy-loaded `CycleWorkspace`.
The group list opens this workspace and historical selection now has an explicit
route. This fixes the normal-router gap found by the browser test. The legacy
`GroupWorkspace` module remains for old tests and migration-era reference, but it
is no longer reachable through normal authenticated application routes. The
cycle workspace imports only the strict v2 service schemas; it does not import
fixture code.

Lifecycle and financial forms retain their UUID intent, original payload,
resource ETags, group ETags and explicit uncertain-outcome retry behavior. The UI
does not silently refresh or rewrite a pending intent. Replayed writes remain
distinguishable. Selecting a historic cycle changes the URL/selection only; it
does not move the group's current-cycle pointer. Personal pages continue to use
their existing APIs and exact money utilities.

## Local disposable workflow

Requirements are Node.js 24, npm, Docker Compose and the local MongoDB container.
This workflow uses a fresh namespace and leaves all existing databases alone.
From the repository root:

```bash
docker compose up -d --wait mongodb
FRESH_TEST_DB="tallynest_fresh_v2_test_$(date +%s%3N)_$(openssl rand -hex 6)"
npm run setup:cycles:fresh:test --prefix backend -- --database "$FRESH_TEST_DB"
MONGO_URI="mongodb://127.0.0.1:27017/$FRESH_TEST_DB" npm run dev --prefix backend
```

In another terminal, run `npm run dev --prefix frontend`, then register a
disposable test account at `http://localhost:5173/register`. Stop each server
with Ctrl+C. The disposable database can be removed only by its exact generated
name after both processes stop. Do not point the installer at an existing local
database. A convenient persistent local-development installer is not provided;
the restrictive test-only setup boundary is intentional pending separate
operator review.

## Verification

`npm run verify:browser` now runs the existing staged Chromium regressions and a
separate normal-composition browser test. The latter provisions a disposable
fresh-v2 schema, starts the actual `backend/server.js` and standard Vite entry,
registers an account through the normal UI, creates a group, opens Cycle 1,
records a shared expense, freezes and closes a zero-net single-member cycle,
opens Cycle 2, returns to Cycle 1 history, and visits personal routes. It checks
desktop/tablet/mobile/narrow page overflow and removes its exact generated DB
after both services exit.

The normal-composition Chromium journey currently exercises one registered
account and a zero-net expense cycle; it does not repeat the full multi-user
settlement journey. The staged Chromium suite exercises three accounts,
invitation boundary behavior, all split types, settlement decisions, recovery,
uncertain retries and historical isolation. The real MongoDB suites exercise
the same production repositories, coordinators and route factory, including
independent-worker concurrency, fresh-v2 readiness and legacy-writer rejection.
This leaves a useful future strengthening task: repeat the multi-user settlement
browser journey through `server.js` itself before hosted release.

In the final Step 3L verification run, `npm run verify:clean` passed with 314
backend tests, 265 frontend tests and 266 standalone MongoDB integration tests.
The run also passed backend/frontend/shared ESLint, configured Prettier checks,
the production frontend build, and both production dependency audits (zero
vulnerabilities). `npm run verify:browser` passed four Chromium tests: three
staged and one normal composition. The staged long flow needed one explicit
authorized recovery after an operation appeared busy following a settlement
proposal; the flow then completed. Both browser database namespaces were
verified absent after cleanup. No hosted HTTPS, Atlas, Vercel, Render, or backup
service validation was performed.

## Security and release status

Local HTTP behavior was exercised only against the disposable MongoDB container.
Hosted HTTPS cookies, reverse-proxy behavior, Vercel same-origin `/api` routing,
Atlas privilege semantics, hosted rate limits, backups and restore procedures
were not tested. These remain mandatory before a hosted release. There is no
legacy migration or release path in this milestone, and an existing legacy or
held database must fail readiness without being modified.

**Status: locally integrated; hosted release remains NO-GO until the full clean
verification, normal and staged Chromium suites, backup/restore readiness, and
hosted HTTPS/security smoke gates are evidenced.**
