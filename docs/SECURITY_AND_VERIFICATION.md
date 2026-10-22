# TallyNest Security Architecture & Verification Evidence

This document details the security model, defense-in-depth mechanisms, automated test coverage, and verification results across TallyNest.

---

## 1. Security Model & Defenses

### Session Management & Cookie Security

- **JWT in HttpOnly Cookies**: Sessions use signed JWTs in host-only cookies (`sfm_access`) with `SameSite=Lax` and path `/`. Tokens are inaccessible to JavaScript via `document.cookie`, reducing direct token access by injected JavaScript. HttpOnly does not prevent injected scripts from making authenticated requests.
- **Production Cookie Attributes**: Production environments construct `__Host-sfm_access` cookies with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and no `Domain`. Hosted forwarding remains unverified.

### Cross-Site Request Forgery (CSRF) Defense

All state-changing HTTP requests (`POST`, `PUT`, `PATCH`, `DELETE`) enforce two defensive layers:

1. **Origin Header Matching**: The incoming `Origin` header must strictly match the configured `CLIENT_ORIGIN`. Unspecified, foreign, or `null` origins return `403 Forbidden`.
2. **Custom Header Requirement**: The client must send `X-CSRF-Protection: 1`. Simple cross-origin requests cannot attach custom headers without triggering CORS preflight rejection.

### Rate Limiting & Abuse Prevention

- **Independent IP Buckets**: Registration and login endpoints apply independent IP rate limits to mitigate brute-force attacks.
- **Per-User Financial Buckets**: Authenticated transaction, budget, recurring, and cycle endpoints apply rate limits scoped to individual user IDs rather than shared IP addresses, preventing cross-user contention within those configured buckets.

### Protected Ingress & Edge Proxying

- Behind Vercel and Render, the application sets `TRUST_PROXY_HOPS=2` and requires `PROXY_SHARED_SECRET`.
- Direct requests attempting to bypass the edge proxy and contact the backend directly are rejected with `403 Forbidden` prior to body parsing or authentication.

### Proxy IP-Chain Diagnostic Status

A passive diagnostic observer was developed and validated locally ([`docs/proxy-ip-chain-diagnostic.md`](proxy-ip-chain-diagnostic.md)) to audit X-Forwarded-For attribution across Vercel and Render.

> [!NOTE]
> The diagnostic passed all local unit and simulated forwarding tests. However, live two-network hosted verification (comparing cellular hotspot vs. broadband egress) was not executed. The hosted deployment's client-IP attribution is not certified as final.

---

## 2. Test Coverage & Quality Assurance

Local results below are a dated snapshot, not production guarantees. Application tests do not require MongoDB. Integration and browser suites use generated local disposable databases.

### Test Suite Breakdown

Local snapshot: 2026-10-22, Node.js 24.21.0. Counts reflect the checked-out suites; hosted checks below remain incomplete.

| Test Layer                   | Test Runner                    | Files / Suites | Documented Baseline                                                                                                                                     |
| ---------------------------- | ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend Unit & API**       | Node.js `--test` runner        | 24 test files  | **338 passing tests**, 0 skips, 0 failures. Covers integer money utilities, split logic, route authorization, Zod validation, and state machines.       |
| **Frontend Component Tests** | Vitest 5 + Testing Library     | 23 test suites | **267 passing tests**. Exercises forms, Top-Layer Dialog focus containment, validation errors, and draft protection.                                    |
| **MongoDB Integration**      | Node runner (serial execution) | 18 test files  | **274 passing cases**. Exercises real MongoDB collection validators, filtered unique indexes, concurrent worker isolation, and SIGKILL recovery drills. |
| **Browser E2E Journeys**     | Playwright Chromium            | 2 suites       | **5 passing tests**: 3 staged fixture regressions and 2 normal-server/normal-React journeys, including multi-user API balances and recovery.            |
| **Dependency Security**      | `npm audit --omit=dev`         | Both packages  | **0 vulnerabilities** across production dependencies in backend and frontend.                                                                           |

The 2026-10-22 documentation cleanup ran `npm test`, `npm run lint`, `npm run format:check`, `npm run verify:deployment:bundle` (production Vite build plus a 33-file synthetic-secret scan), `npm run audit:prod`, `npm run verify:mongo`, and `npm run verify:browser` successfully. Backend, frontend and MongoDB suites had zero failures/skips; all owned media/browser database cleanup checks passed. The three media scripts also completed against permanent screenshots or a generated local database. All 430 GIF frames decoded without blank/corrupt frames, all six GIFs loop indefinitely, and 53 local document/media links resolved.

These local runs did not exercise hosted services, independent fresh-v2 encrypted archive/key retrieval or a hosted restore. The secret scan of the public candidate tree found only 15 unchanged example/test-fixture matches, with no match in changed/new artifacts; this is a scoped scan, not a guarantee against all secret exposure.

### Verification Commands

```bash
# Isolated tests, lint, formatting, production build/canary, and audits
npm run verify:fast

# Real MongoDB integration tests (requires local Docker instance)
npm run verify:mongo

# End-to-end browser journeys in headless Chromium
npm run verify:browser

# Fast checks (including production build/canary) plus MongoDB; browser is separate
npm run verify
```

---

## 3. Operational & Free-Tier Limitations

1. **Free-Tier Cold Starts**: Hosted on Render's free tier, the backend spins down after inactivity. Wake-up commonly takes about a minute; no fixed maximum is promised. See [Render Free limitations](https://render.com/docs/free).
2. **In-Memory Rate Limiter**: Rate counters reside in Node.js process memory. Server restarts reset active bucket counters.
3. **Process-Local Background Worker**: `backend/src/jobs/recurring.job.js` processes a bounded batch of 20 on startup and schedules another tick after 60 seconds. It runs while the API process runs, including without an active user session, but cannot run while Render sleeps. Bounded catch-up is not guaranteed punctual scheduling.
4. **Demonstration Context**: TallyNest is an engineering portfolio project using generated demonstration records. It does not connect to real financial clearing houses or banking institutions.
5. **Unverified Hosted Recovery**: The demo is not certified for real financial data. Independently retained backup/key custody, encrypted hosted restore/reconciliation, actual Atlas runtime grants, and hosted two-network IP-chain verification remain incomplete. RPO/RTO are unmeasured; no zero-data-loss, bank-grade, high-availability, or production-readiness guarantee is made.
6. **Session Lifetime**: JWTs expire (900 seconds by default). There is no refresh-token flow; logout clears the browser cookie but does not revoke an already copied token before expiry.

## Financial operation recovery

1. After a timeout or lost response, inspect authoritative records before creating another intent. A failed response does not prove the write failed. Preserve the original idempotency key, payload and conditional headers for the explicit retry offered by the UI; do not substitute a new key or newer ETags into an uncertain retry.
2. Full reload discards memory-only intent state. Reauthenticate if necessary, reopen the affected group/cycle and review current records. Do not recreate a missing-looking expense or settlement blindly.
3. When the workspace reports financial activity blocked, the original actor or owner may use **Recover pending operation**. This calls the authenticated `POST /api/groups/:groupId/financial-recovery` with the normal Origin/CSRF checks and reloads authoritative state. It completes only the original fixed operation; it cannot choose a new amount, forgive debt, or remove a maintenance hold.
4. If recovery remains blocked or reports corruption, stop further financial actions for the group. Preserve reservations, original IDs, receipts, tombstones and versions. Retain sanitized error codes and the code revision privately; investigate from an independently verified backup or isolated copy. Never clear `financialOperation`, edit balances, disable validators, force-unlock by age, or downgrade to a legacy writer.
5. Lifecycle close requires every member balance zero and no pending settlements. Settlement confirmation records a recipient acknowledgment; it does not verify an external bank transfer. Later cycle writes cannot be erased by casually restoring an older backup.

Use the [deployment/recovery rehearsal plan](deployment-rehearsal-plan.md) for stopped-writer fencing, fresh provisioning checkpoint recovery, encrypted backup/key custody, isolated restore and acceptance gates. The [settlement-cycle cutover runbook](runbooks/settlement-cycle-cutover.md) preserves the separate maintenance-held legacy migration procedure. Neither document authorizes hosted changes or real-data cutover.
