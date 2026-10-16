# Phase 5, Step 1 — Engineering audit

Audit date: 2026-10-16. Checkout: `228c07b` (`feat(groups): implement collaborative finance frontend`). The working tree was clean at the start. This is a read-only audit of application behavior; this document is the only repository file added. No dependencies, source code, configuration, secrets, or database records were changed. No deployment was performed.

## 1. Executive summary

TallyNest has a sound foundation for exact personal and collaborative accounting: decimal-string input, integer-paise storage, BigInt reconciliation, owner/group scoping, conditional updates, durable generation receipts, and serialized group financial operations. The inspected implementation does **not** justify a claim of a demonstrated cross-user financial leak, arithmetic rounding defect, or bypass of the settlement freeze. Passing tests are supporting evidence, not a proof of every distributed failure case.

It is **not yet ready for an unattended public financial-data deployment**. The most consequential findings are retry duplication in personal finance, the deliberately single-cycle group lifecycle, and missing production authentication/proxy/backup acceptance gates. These are different kinds of issues; they must not be conflated with a verified financial exploit.

| ID  | Severity | Classification                               | Finding                                                                                                                                              |
| --- | -------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | High     | Verified workflow defect                     | Unknown personal transaction creation outcomes can be resubmitted as duplicate financial records; recurring template creation has the analogous gap. |
| H2  | High     | Verified design limitation                   | Settlement initialization permanently ends expense activity for the whole group; no reusable cycles or historical correction workflow exists.        |
| H3  | High     | Deployment risk / verified configuration gap | Direct Vercel-to-unrelated-backend cookie authentication is incompatible with the current same-site contract; SPA/proxy deployment rules are absent. |
| H4  | High     | Deployment risk / verified default           | Proxy trust is disabled while authentication/invitation limits use client IP; production users can share a proxy-wide limiter.                       |
| H5  | High     | Operational readiness risk                   | No versioned backup/restore and financial recovery operational acceptance procedure is supplied.                                                     |
| M1  | Medium   | Verified lifecycle limitation                | Pending settlements reserve capacity indefinitely; senders cannot withdraw them.                                                                     |
| M2  | Medium   | Availability risk                            | Durable financial/recurring reservations fail closed, but persistent failures lack an operator diagnostic/recovery workflow.                         |
| M3  | Medium   | Performance/resource risk                    | Very old recurrence starts and oldest-first global catch-up can monopolize bounded processing and grow storage.                                      |
| M4  | Medium   | Deployment/integrity risk                    | Startup installs validators and indexes with administrative operations; existing-data migration and actual Atlas credentials remain unverified.      |
| M5  | Medium   | Dependency finding                           | Three High advisory entries exist in the development-only nodemon dependency chain; production audits are clean.                                     |
| M6  | Medium   | Frontend reliability risk                    | No product-level route error boundary; lazy-route failures fall back to the router's generic error handling.                                         |
| M7  | Medium   | Performance risk                             | Financial summaries rescan period/group history; no representative M0-scale performance measurements exist.                                          |
| M8  | Medium   | Privacy/deployment risk                      | Invitation capabilities occur in initial frontend and API URL paths; referrer controls do not prevent host/access-log capture.                       |
| M9  | Medium   | Verified tooling/coverage gap                | No checked-in CI/browser release gate; shared JS is outside ordinary package lint/format scopes.                                                     |
| L1  | Low      | Verified technical debt                      | Transaction tests call deprecated validateSync, generating 95 warnings in this run.                                                                  |
| L2  | Low      | Verified code-level accessibility defect     | Group form validation attempts focus before React renders the new invalid-field state.                                                               |
| L3  | Low      | Verified header inconsistency                | Parser failures on private API paths bypass route-level no-store headers.                                                                            |
| L4  | Low      | Maintainability / optional improvement       | Dense backend formatting, duplicated protocol plumbing and deferred UX polish need a controlled follow-up.                                           |

Severity reflects impact in the intended deployment/workflow, not simply an advisory score. In particular, M5 is not a remotely exploitable production vulnerability established by this audit. No Critical issue was confirmed. H3–H5 are release gates, not claims of observed hosting incidents.

### Checks actually executed

| Check                                                                          | Result                                                                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `node --version`                                                               | `v24.21.0`, consistent with `.nvmrc:1` and both package engines                                                  |
| `npm test --prefix backend`                                                    | 296 passed, zero failed/skipped; 95 validateSync deprecation warnings                                            |
| `npm test --prefix frontend`                                                   | 240 passed across 19 files, zero failed                                                                          |
| `npm run lint --prefix backend`                                                | Passed                                                                                                           |
| `npm run lint --prefix frontend`                                               | Passed                                                                                                           |
| `npm run format:check --prefix frontend`                                       | Passed                                                                                                           |
| `npm run build --prefix frontend -- --outDir /tmp/tallynest-phase5-audit-dist` | Passed; output outside the repository                                                                            |
| `npm ls --prefix backend --depth=0` and frontend equivalent                    | Passed; no top-level invalid dependency tree reported                                                            |
| `npm audit --json --prefix backend`                                            | Exit 1: three High entries, one development dependency chain                                                     |
| `npm audit --json --prefix frontend`                                           | Exit 0: zero findings including development dependencies                                                         |
| Both `npm audit --omit=dev` commands                                           | Passed: zero vulnerabilities                                                                                     |
| `docker compose config --quiet`                                                | Passed; configuration validation only                                                                            |
| In-process personal-create replay probe with a mock repository                 | Two identical submissions produced two mock records, total 200 paise instead of one 100-paise intent             |
| Isolated Express malformed-JSON probe, no database connection                  | POST `/api/groups` returned sanitized 400 `INVALID_REQUEST`, with no Cache-Control header; trust proxy was false |
| `git diff --check`                                                             | Passed after report creation                                                                                     |

Command logs/build output were placed in `/tmp/tallynest-phase5-*`, not committed artifacts. The ordinary backend and frontend tests use isolated doubles. **MongoDB integration suites were inspected but not executed**, because they create/delete database records and this audit forbids altering database data. No database connection, collection inspection, container start, browser walkthrough, load test, Atlas failover, backup restore, or hosted HTTPS cookie test was performed. Earlier documents' MongoDB/browser results remain historical reports, not current audit verification. No coverage percentage or production readiness certification is claimed.

## 2. Current architecture assessment

The live code follows Controller → Service → Repository → Model. Routes compose authentication, rate limiting, CSRF and controllers. Services own full-document validation, permissions, reconciliation and pagination. Repositories use owner/group predicates and versioned writes. React services validate response envelopes and hooks guard stale responses.

Useful existing boundaries:

- Shared pure definitions and money/split logic: `shared/money.js:16-43`, `shared/split.js:1-92`, `shared/transaction.constants.js`; backend split adapter `backend/src/utils/split.js:1-6`.
- Personal financial records, recurring templates, shared expenses and settlements remain separate collections. Generated recurring entries enter the personal ledger; group obligations do not.
- Group embedded memberships/invitations make initial ownership and joining single-document operations. This is an intentional, bounded 100-member design, not a missing cross-document transaction.
- Mongoose and Zod protect application writes; strict MongoDB validators additionally protect group/expense/settlement document states. Validators cannot prove foreign-key membership or historical transitions by themselves.
- App construction is injectable and database-independent (`backend/app.js:30-80`); `backend/server.js:46-74` owns connection, collection setup, listening and the recurring job.

The architecture should be extended incrementally. There is no evidence that Redux, a message broker, a second financial ledger, or a framework rewrite is needed.

## 3. Critical and high-priority findings

### H1 — Unknown personal creation outcomes can duplicate money

**Severity/status:** High; verified workflow defect, with a mock-service reproduction. This is not an arithmetic error or a claim that every retry duplicates records.

**Evidence:** `backend/src/services/transaction.service.js:44-46` always creates; `backend/src/repositories/transaction.repository.js:22-24` performs a new save without a creation receipt. `frontend/src/components/transactions/TransactionForm.jsx:85-96` treats network/5xx errors as retryable form errors and clears pending. The user can submit again after the first request committed but its response was lost. The isolated audit probe called the actual service twice with identical data and observed two distinct mock insertions. Recurring template creation is likewise unconditional (`backend/src/services/recurring.service.js:26`, `backend/src/repositories/recurring.repository.js:12-14`, `frontend/src/components/recurring/RecurringForm.jsx:103-118`); duplicated templates can later each generate valid, independently idempotent occurrences.

**Impact:** Duplicate personal income/expense totals or duplicate schedules, despite each individual record being financially valid. Generation idempotency does not deduplicate two different schedules.

**Recommendation/difficulty:** Medium. Extend the existing UUID creation-intent/unique receipt pattern to manual transactions and recurring schedule creation. Retain the same key and frozen payload across uncertain retries; reject changed-payload reuse; return explicit replay metadata. Keep durable receipts after deletion. Until then, block blind resubmission after uncertain outcomes and require authoritative review. Do not deduplicate by matching titles/dates/amounts: identical legitimate entries are valid.

**Required regression tests:** Commit-then-drop-response, simultaneous same-key requests, changed payload with the same key, replay after editing/deletion, full reload guidance, and duplicated-template prevention. Add real disposable MongoDB uniqueness tests in the implementation phase.

### H2 — Groups support only one immutable settlement era

**Severity/status:** High; verified and documented design limitation, not a lock bypass.

**Evidence:** `backend/src/repositories/group.repository.js:40-48` excludes every expense reservation once `settlementStartedAt` exists; `backend/src/services/group-financial.service.js:225-230` also rejects it. The first capacity-valid proposal sets the marker before insertion (`:120-132`). Group deletion and membership removal require no `financialHistoryAt` (`backend/src/repositories/group.repository.js:54`, `backend/src/repositories/membership.repository.js:18-22`). Creator identity and exactly one creator-owner are enforced by `backend/src/models/group.model.js:30-38,63-68`. There is no transfer/correction/cycle endpoint in `backend/src/routes/group.routes.js:18-41`.

**Impact:** A continuing household/travel group cannot record a second expense cycle after even a rejected first settlement. Fully settled members still cannot leave. An unavailable sole owner prevents owner-only administration. Incorrect acknowledged settlements have no reversal workflow. A failed insertion after mode establishment may leave an intentional permanent freeze.

**Recommendation/difficulty:** High. Introduce explicit immutable settlement cycles using the design in section 5; do not remove any current lock predicate. Owner succession, membership archival and corrections require separate audited policies. Preserve legacy groups' frozen history during migration.

**Required regression tests:** Two successive cycles, expense versus close/freeze races, delayed original workers after recovery, migration of frozen groups, duplicate opening/closing requests, no hidden balance reset, history reads after membership changes, and explicit correction conservation.

### H3 — Production cookie topology and SPA routing are unresolved

**Severity/status:** High; verified configuration gap and conditional deployment failure, not an observed deployed incident.

**Evidence:** Production cookies are host-only Secure `__Host-sfm_access`, SameSite=Lax (`backend/app.js:51-55`). Production Axios defaults to same-origin `/api` (`frontend/src/services/api.js:42-45`), while the checked-in development example uses a direct API URL (`frontend/.env.example:2`). No tracked `vercel.json` or equivalent production proxy/SPA configuration exists. README's production section explicitly leaves serving infrastructure to deployment.

**Impact:** A browser SPA on `*.vercel.app` directly calling an unrelated `*.onrender.com` API cannot rely on Lax cookies for cross-site XHR. Correct CORS/withCredentials does not override SameSite. Deep links and invitation reloads also need SPA fallback. This can make authentication and joining unusable despite passing local tests.

**Recommendation/difficulty:** Medium. Prefer the no-paid-service topology: Vercel frontend sends same-origin `/api/*`, an external rewrite forwards to Express, and the SPA fallback applies only after API/static routing. Preserve Origin, Cookie, Set-Cookie, If-Match, Idempotency-Key and ETag correctly; never cache authenticated API responses. Verify the actual proxy rather than assuming headers survive. Keep `CLIENT_ORIGIN` the exact browser HTTPS origin. Do not weaken CSRF or simply change SameSite to None. If intentionally using sibling custom domains later, document the same-site/security assumptions and any domain cost separately.

**Required regression tests:** Hosted HTTPS register/login/me/logout, hard reload of every protected route and invitation, expired cookies, rejected foreign Origin, ETag/CSRF forwarding, API 404 never serving index.html, and two-account cache isolation. Official references: [Vercel Vite SPA routing](https://vercel.com/docs/frameworks/frontend/vite), [external rewrites](https://vercel.com/docs/routing/rewrites), [cookie semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

### H4 — Proxy-aware IP throttling has no production configuration

**Severity/status:** High; verified default with deployment-dependent availability/security consequences.

**Evidence:** No trust-proxy configuration appears in `backend/app.js:37-47`; the isolated app probe returned false. Authentication uses default per-IP keys with 5/10 attempts per 15 minutes (`backend/src/routes/auth.routes.js:8-25`); invitation ingress also uses an IP limiter (`backend/src/routes/invitation.routes.js:9-15`). Authenticated finance routes key by user ID, so this finding does not incorrectly apply to every limiter.

**Impact:** Behind a reverse proxy, unrelated users may share its IP bucket. Blindly enabling trust for every forwarded header would introduce spoofing instead. Restarting/sleeping processes reset the in-memory counters; multiple instances do not share limits.

**Recommendation/difficulty:** Medium. Map and constrain the actual Vercel/host proxy path and direct-backend ingress. Configure trusted proxies/hops only when the host guarantees header sanitization; reject spoofable alternative paths. Test IPv4/IPv6 behavior. Document single-instance counter limitations; introduce a bounded database-backed limiter only if scale/security needs justify it, without adding paid infrastructure.

**Required regression tests:** Distinct real client IPs through the deployed chain, forged X-Forwarded-For, differing hop counts, direct API ingress, restart behavior, and per-user limits remaining isolated. [Official limiter proxy guidance](https://github.com/express-rate-limit/express-rate-limit/wiki/Troubleshooting-Proxy-Issues).

### H5 — Recovery and backup operation is not yet a release procedure

**Severity/status:** High; operational readiness risk. No claim is made about an unseen Atlas project's actual backup settings.

**Evidence:** `docker-compose.yml:5-8` persists one local volume, which is not an independent backup. README's local MongoDB section describes volume deletion but supplies no restore drill. `backend/src/services/group-financial.service.js:184-212,247-260` can retain interrupted work; `backend/src/utils/durable-write.js:1-3` improves write acknowledgement but is not backup. No tracked backup/restore runbook or automated restore verification exists.

**Impact:** Accidental deletion, corrupt administrative changes, lost Atlas access or an operator incorrectly clearing a reservation can destroy the ability to reconcile financial history. A successful startup is not evidence of recoverability.

**Recommendation/difficulty:** Medium–High. Define RPO/RTO and an approved no-cost export/backup strategy with encrypted restricted storage, retention, and a restore drill into a disposable database. Preserve tombstones, idempotency receipts, reservations, group/cycle markers and indexes/validators together. Quiesce writers for a logically consistent export where no snapshot guarantee exists. Document operator diagnosis without editing frozen payloads or erasing locks. Current Atlas documentation lists opt-in Free-cluster backups; verify account availability, retention and cost before adopting rather than repeating older blanket claims that M0 has no backups.

**Required regression tests:** Restore all modules, rebuild/verify indexes and validators, replay interrupted operations without duplicates, retain deleted receipts, reconcile zero-sum groups, and prevent restored overdue schedules from uncontrolled execution before operator approval. See [current Atlas limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).

## 4. Financial correctness review

| Area                      | Observed guarantees and limits                                                                                                                                                                                                                                                             | Source evidence                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input/formatting          | Decimal strings convert with BigInt and reject overprecision/unsafe results; positive money is separately enforced. Signed formatting is exact. No observed parseFloat-based financial arithmetic.                                                                                         | `shared/money.js:16-43`; `frontend/src/utils/transactions.js:15-31`; `backend/src/validators/transaction.validator.js:1-39`                                                                                 |
| Database money sums       | Convert valid safe integer through Int64 to Decimal128; integrity branch checks conversion did not truncate. Service sums/reconciliation use BigInt before safe JSON conversion.                                                                                                           | `backend/src/utils/financial-aggregation.js:3-22`; `backend/src/services/budget-summary.service.js:14-33,47-85`                                                                                             |
| Budgets                   | Expense-only half-open UTC month, income excluded, categories reconcile budgeted + unbudgeted = total. Budgets/expenses are two best-effort reads, not a snapshot. Extreme utilization can exceed safe basis-point output and deliberately return overflow even when spending itself fits. | `backend/src/repositories/budget-summary.repository.js:11-45`; `backend/src/services/budget-summary.service.js:50-85`                                                                                       |
| Dashboard                 | Income, expense, series and category totals reconcile; no verified bank balance implied. Plotting uses approximate ratios, exact tooltips/data tables remain available.                                                                                                                    | `backend/src/services/dashboard.service.js:39-80`; `frontend/src/components/dashboard/DashboardCharts.jsx:28-40,71-99`; `frontend/src/components/dashboard/DashboardPanels.jsx:75-95`                       |
| Splits                    | Equal remainder assignment by sorted ID; percentage BigInt largest-remainder with ID ties; exact sum; positive shares. Browser and backend share the algorithm.                                                                                                                            | `shared/split.js:1-92`; `backend/src/repositories/group-expense.repository.js:8-12`; `frontend/src/utils/groups.js:101-132`                                                                                 |
| Group balances            | Paid − assigned + confirmed sent − confirmed received; pending only reserves capacity. Per-member and total-volume overflow rejected, zero-sum checked. Conservative volume limits can reject a group whose net alone is safe.                                                             | `backend/src/utils/group-balances.js:15-87,125-144`                                                                                                                                                         |
| Suggestions               | Greedy stable ID ordering, no circular or excessive transfers, no claim of globally minimum transfer count. Suggestions are not settlement records/payments.                                                                                                                               | `backend/src/utils/group-balances.js:89-123`                                                                                                                                                                |
| Stored corruption         | Group aggregates check validators and identities including deleted receipts and fail closed. Personal summary integrity applies to records matching its owner/date/type/currency scope; it is not a global database integrity scanner.                                                     | `backend/src/repositories/group-balance.repository.js:19-123`; `backend/src/repositories/budget-summary.repository.js:25-35`                                                                                |
| History and deletion      | Shared expenses are tombstoned, not erased; receipt key remains unique. Manual personal entries are hard deleted; generated entries retain tombstones. Receipt replay never intentionally recreates deleted occurrences.                                                                   | `backend/src/repositories/group-expense.repository.js:20-41`; `backend/src/services/group-expense.service.js:52-55`; `backend/src/repositories/transaction.repository.js:39-57`                             |
| Recurrence                | Anchored UTC clock/day; short-month clamp without drift; leap-year handling; end inclusive; dates beyond 9999 exhaust. Durable pending fixed ID, unique schedule/date receipt and CAS advancement support restart recovery.                                                                | `backend/src/utils/recurrence.js:5-32`; `backend/src/services/recurring-engine.service.js:21-33`; `backend/src/repositories/recurring.repository.js:39-47`; `backend/src/models/transaction.model.js:62-68` |
| Personal/group separation | Group operations write GroupExpense/GroupSettlement, not Transaction/Budget. Generated recurring transactions participate in personal summaries through the existing transaction model.                                                                                                    | `backend/src/services/group-financial.service.js:29-182`; `backend/src/repositories/dashboard.repository.js:2,14`; `backend/src/repositories/budget-summary.repository.js:3,25`                             |

### M1 — Pending settlement capacity has no sender escape hatch

**Severity/status:** Medium; verified lifecycle limitation. `backend/src/utils/group-balances.js:125-139` subtracts pending outgoing/incoming capacity. `backend/src/routes/group.routes.js:19-23` offers recipient confirm/reject only; `backend/src/services/settlement.service.js:183-231` enforces recipient decisions and terminality. No sender withdrawal/expiry exists. An unavailable recipient can reserve the sender's entire debt indefinitely.

**Solution/difficulty:** Medium. Design an auditable pending-only cancellation or explicit expiry terminal event under the same financial reservation protocol; do not delete pending records or reverse confirmed entries implicitly. Preserve first-proposal freeze semantics until cycles are introduced. **Tests:** cancellation versus confirm race, duplicate cancellation, capacity release, expiry clock boundaries, sender/recipient authorization, terminal audit invariants.

### M2 — Safe fail-closed reservations can remain unavailable indefinitely

**Severity/status:** Medium; availability risk, not evidence of duplicate generation. Group recovery retains unknown outcomes and requires actor/owner (`backend/src/services/group-financial.service.js:184-212,247-260`). Recurring pause/edit/delete refuses pending work (`backend/src/services/recurring.service.js:38-62`), while engine errors are counts without classification (`backend/src/services/recurring-engine.service.js:34-39`). A permanently invalid record/driver condition can block normal repair through the API.

**Solution/difficulty:** Medium. Add sanitized operation IDs/error classes and operational diagnostics, a bounded recover-and-inspect runbook, and alerting through available host logs. Keep payloads/tokens out of logs. Never TTL-expire reservations or clear them on a timer: old workers may still complete. **Tests:** reservation/write/release failures, malformed durable payload, repeated and concurrent recovery, stale worker after recovery, database unavailable then restored. Existing controlled-failure integration tests are useful evidence of intent, not a newly executed OS-crash test.

### M3 — Catch-up fairness and historical backlog are unbounded over time

**Severity/status:** Medium; resource/performance risk. Start years 0001–9999 are permitted (`backend/src/validators/recurring.validator.js:7-15`), scans choose the oldest date globally (`backend/src/repositories/recurring.repository.js:34-37`), and a run repeatedly chooses due work until 20 operations/approximately five seconds (`backend/src/services/recurring-engine.service.js:11-39`; `backend/src/jobs/recurring.job.js:2-11`). A centuries-old daily schedule can consume many batches and considerable storage, delaying later due work. The time check is between awaits, not a hard five-second request deadline.

**Solution/difficulty:** Medium. Introduce an explicit permitted backfill policy, bounded per-schedule/owner work and fair continuation across runs, plus visible backlog counts. Require deliberate acknowledgement for historical generation; never silently skip financial entries. **Tests:** multiple owners with disproportionate backlogs, very old starts, restart continuation, slow DB operations, bounded work and no duplicates/skips. A sleeping service still cannot run precisely on time.

## 5. Proposed reusable settlement cycles — design only

This proposal is not implemented and does not authorize weakening existing locks.

1. Add stable `GroupFinancialCycle` identity with `open`, `frozen`, `closed` lifecycle, immutable group/currency, audit timestamps/version, close receipt and optional reconciled snapshot digest. Shared expenses and settlements acquire immutable cycle IDs. Store `currentCycleId` and transitions through the existing serialized group financial-operation protocol. One group-wide financial operation remains the conservative initial concurrency boundary.
2. Expenses can be created/changed only in that specific open cycle. The first valid settlement proposal freezes that cycle; later cycles do not make old expenses editable. Database reservation predicates must bind the cycle ID, version and state. Use fixed operation IDs/targets, receipts and CAS for every cross-document effect. A cycle-state read followed by an unfenced expense update is still unsafe.
3. Initially close only when exact nets are zero, no pending settlements/reservations exist, and the reconciled group/cycle revision is unchanged. Persist a close receipt before advancing to another cycle through a recoverable reserved operation. New cycle creation/pointer assignment must recover the same fixed ID after interruption, not manufacture two open cycles.
4. Start the next cycle at zero. **Do not carry old debts implicitly.** If later allowing nonzero closure, introduce explicit immutable opening/carry entries with once-only lineage so debt cannot be dropped or counted twice. Totals and suggestions must identify cycle scope.
5. Migrate current groups into one legacy cycle retaining existing financialHistoryAt, settlementStartedAt, tombstones, receipts and identities. Already frozen groups remain frozen. Audit and reconcile before enabling next-cycle creation. Do not relabel old data as editable.
6. Preserve the permanent group history marker. Replace future membership departure with explicit archival/effective membership, not physical deletion of historical identity. Departure requires zero obligations and no pending operations across all relevant cycles. Historical records retain payer/participant IDs; visibility and account erasure/pseudonymization require a privacy policy. Creator attribution and present administrative owner must become distinct before owner succession is added, with accepted transfer, no ownerless interval and atomic version checks.
7. Corrections must reference the original immutable expense/settlement through append-only adjustment/reversal events with explicit authorization/acknowledgement rules and capacity revalidation. Do not mutate a confirmed settlement, delete its receipt or advertise a payment reversal. This is a separate feature requiring a financial/audit specification.
8. Roll out with old workers stopped or a protocol-version gate. Cross-document state validators cannot alone stop a legacy writer. Preserve compatibility with standalone MongoDB through frozen-operation receipts; a replica-set transaction alternative must be an explicit architecture decision with dedicated tests.

**Acceptance tests before implementation is accepted:** close/open interruption at every boundary; duplicate requests; concurrent expense/freeze/close; delayed workers; zero-sum reconciliation per cycle and group; rejected settlements keeping the cycle frozen; archival identity access; legacy migration without changing balances; idempotency keys scoped safely across cycles; no personal finance changes. No globally optimal debt minimizer or payment execution is needed.

## 6. Authentication and security review

Existing protections are meaningful:

- JWT HS256 allowlist, issuer/audience, exp/iat/subject and maxAge checks (`backend/src/services/auth.service.js:25-31,61-79`). TTL defaults to 900 seconds and is constrained to 60–1800 (`backend/src/config/env.js:9-18`). Existing issuer/cookie branding is compatibility metadata, not an issue to rename casually.
- HTTP-only, Secure production, host-only cookies with matching clear attributes (`backend/app.js:51-55`; `backend/src/controllers/auth.controller.js:1-17`). Logout does not revoke a copied JWT; no refresh tokens exist. This is a documented short-lived session limitation, not broken cryptography. Introduce revocation/session records only if requirements justify their complexity.
- Exact configured Origin plus custom mutation header, independent of SameSite (`backend/src/middleware/csrf.middleware.js:3-10`). CORS restricts the browser origin and exposes ETag (`backend/app.js:41-45`). Non-browser callers can forge Origin, so membership/JWT authorization remains essential and is present.
- bcrypt cost 12, byte bounds and generic login failure (`backend/src/services/password.service.js:4-17`; `backend/src/validators/auth.validator.js:4-13`; `backend/src/services/auth.service.js:54-59`). Duplicate registration reveals account existence intentionally. No account recovery flow exists; treat that as a product scope decision before public use.
- Strict Zod object schemas reject operators/protected fields; repositories include owner/group IDs. Membership-derived roles are server state, not request data. Registered user existence is checked by authentication (`backend/src/middleware/auth.middleware.js:3-9`). Group roster projects name/ID only (`backend/src/repositories/membership.repository.js:9-11`).
- Successful private routes set no-store; production/private error messages are sanitized (`backend/src/routes/group.routes.js:13-16`; `backend/src/middleware/errorHandler.js:13-41`). API Helmet is not a security-header configuration for separately served SPA HTML.

### M8 — URL capabilities require logging controls outside React

**Severity/status:** Medium; privacy/deployment risk, not a confirmed secret leak. Tokens are 32 random bytes, SHA-256 hashes stored, expiry and usage checked at acceptance in the group write (`backend/src/services/invitation.service.js:12-14,36-41`; `backend/src/repositories/invitation.repository.js:25-39`). Frontend links necessarily contain the raw token (`frontend/src/components/groups/GroupInvitations.jsx:117-120`), as do inspection/accept paths. `frontend/index.html:5` and `backend/src/routes/invitation.routes.js:12` set no-referrer protections; `frontend/src/layouts/AppLayout.jsx:20-35` preserves anonymous auth navigation in a fragment. There is no application request logger, but host/proxy/browser history and clipboard exposure remain.

**Solution/difficulty:** Medium. Redact these path segments in all infrastructure/access/error telemetry, avoid token-bearing analytics, set no-referrer as a hosting response header, disable caching, and keep explicit acceptance/history replacement. Consider fragment-based sharing in a separately specified contract if host-path exposure cannot be controlled; fragments still need careful reload/auth handling. **Tests:** initial page request, auth reload/register transition, expiry/revocation, clipboard failure, accepted-link history replacement, and inspection of actual hosting logs without publishing tokens.

### L3 — Early private errors omit no-store

**Severity/status:** Low; reproduced header inconsistency. `backend/app.js:47` runs JSON parsing before private routers' cache middleware. `backend/src/middleware/errorHandler.js:36-41` sanitizes the error but does not set no-store. The isolated malformed-JSON probe returned 400 with `Cache-Control: null`. It disclosed no private financial data; this is not a demonstrated cache leak.

**Solution/difficulty:** Low. Install no-store for the API/private prefix before parsing, and retain error sanitization. **Tests:** malformed/oversized JSON, early auth errors, case aliases and proxy caching behavior across accounts.

## 7. Frontend and UI review

Positive findings: protected content waits for session restoration (`frontend/src/layouts/AppLayout.jsx:18-35`); unauthorized responses invalidate in-memory sessions (`frontend/src/services/api.js:26-38`); requests use credentials and CSRF (`:15-24`). Group hooks scope state to keys/revisions and invalidate stale completions (`frontend/src/hooks/useGroupData.js:1-160`). Record forms retain drafts on version conflicts, require explicit review, and preserve frozen idempotent creation intents (`frontend/src/components/groups/RecordForm.jsx:80-177`). Settlement terminal decisions cannot be blindly retried (`frontend/src/components/groups/GroupAction.jsx:24-55`).

Native dialogs contain focus and restore it with fallbacks (`frontend/src/components/ui/Dialog.jsx:14-39`); labels/errors use aria-describedby (`frontend/src/components/ui/Field.jsx:4-18`). Reduced motion is supported (`frontend/src/main.jsx:12-16`; `frontend/src/styles/groups.css:528-531`). Monetary formatting never depends on a float rupee conversion. Charts provide exact tables, labels and a chart-specific error boundary (`frontend/src/components/dashboard/DashboardPanels.jsx:14-27,75-95`). These source observations do not replace screen-reader or multi-browser testing.

### M6 — Lazy route failures lack a branded recovery boundary

**Severity/status:** Medium; confirmed missing product-level handling, potential runtime failure. Routes use lazy imports/Suspense (`frontend/src/App.jsx:10-34,44-99`); the data router has no explicit errorElement (`frontend/src/main.jsx:9`). Suspense handles pending imports, not rejected imports. React Router can show its default error page; the chart-specific boundary does not cover group/ledger route failures.

**Solution/difficulty:** Low–Medium. Add a product route error boundary with safe reload/navigation and retained session behavior; avoid infinite reload on missing old chunks after a release. **Tests:** rejected dynamic import, offline navigation, invalid render/response exception, no sensitive error text and successful recovery after refresh.

### L2 — First group validation failure may not focus the invalid control

**Severity/status:** Low; code-level defect. `frontend/src/components/groups/RecordForm.jsx:87-90` calls setErrors and immediately queries `[aria-invalid="true"]`. The new attributes are only rendered on React's next commit, so a first invalid submission has nothing to focus; existing invalid controls can also be stale. Unlike personal forms, it does not target the newly computed error key directly.

**Solution/difficulty:** Low. Focus the first invalid element after errors commit, or map computed error keys to refs/names. Provide a focusable summary for split/group errors without an individual input. **Tests:** first invalid submit from Save, multiple errors, corrected first field, split error focus, keyboard and screen-reader announcement. No real assistive-technology test was executed here.

### Deferred improvement checklist (retain for the final UI pass)

The checkout does not contain a single canonical, itemized UI backlog. The following preserves the earlier stated deferred-polish scope and converts source-observed areas into acceptance tasks; it does not pretend unspecified historic requests were recovered verbatim. These are **Low-severity optional improvements/risk checks**, not confirmed layout failures. Evidence: `frontend/src/styles/groups.css:484-527`, `frontend/src/styles/transactions.css:574-687`, `frontend/src/components/dashboard/DashboardPanels.jsx:29-35`, `frontend/src/components/groups/SettlementList.jsx:15-45`, `frontend/src/components/groups/RecordForm.jsx:38-74`, `frontend/src/context/AuthProvider.jsx:36-55`.

- [ ] Recheck 1440/1024/390/320 widths across **all** modules, including dialogs, 100-member rosters, long names and MAX_SAFE_INTEGER formatted amounts. Verify no clipping/page overflow, 200% zoom and usable touch targets; do not infer this from one screenshot.
- [ ] Harmonize heading rhythm, compact mobile spacing, table/card density and long-amount wrapping without redesigning completed pages. Preserve mint identity and textual income/expense/status distinctions.
- [ ] Make empty/loading/retry/success states and destructive/conflict wording consistent; ensure success appears only after authoritative completion. Keep permanent restrictions discoverable without repeating full warnings in every panel.
- [ ] Replace ad hoc group popstate interception with supported router blocking when safely feasible; test back/forward, app navigation, full reload, Escape/backdrop, focus restoration and cancellation during writes. Preserve uncertain-outcome warnings.
- [ ] Explicitly decide how drafts survive session expiration: current auth invalidation unmounts protected forms and memory-only retry keys. Never expose a previous user's financial draft to the next signed-in account; do not store invitation secrets persistently.
- [ ] Improve settlement discovery through supported server filters/incoming counts; current loaded-only filters are honestly labeled and must not be relabeled as complete history.
- [ ] Run keyboard and screen-reader checks for all dialogs, errors and chart/table alternatives; add automated accessibility checks selectively. Preserve reduced motion and visible focus. Tests must inspect actual focus, not only that a dialog role exists.
- [ ] Improve real-time freshness indicators/last-refreshed text before considering push infrastructure. Do not reconstruct authoritative balances client-side.

Each checklist item's implementation difficulty is Low–Medium except server filtering/draft lifecycle (Medium). Required regression evidence is browser screenshots at the stated sizes plus keyboard/session/error-flow tests; current automated tests alone do not establish contrast, assistive-technology behavior or mobile usability.

## 8. Database and deployment review

### M4 — Schema setup is coupled to application startup

**Severity/status:** Medium; verified operational coupling with unverified production privilege/data compatibility. Startup calls all ensure functions before listening (`backend/server.js:49-55`). Group and expense setup runs createCollection, collMod and init (`backend/src/repositories/group.repository.js:58-64`; `backend/src/repositories/group-expense.repository.js:46-50`); settlements do the same (`backend/src/repositories/settlement.repository.js:84-102`). Mongoose init is not a full drift/migration audit of an existing collection. Applying a validator also does not retroactively repair every invalid historical record.

**Solution/difficulty:** Medium. Provide a versioned, idempotent migration/preflight procedure: verify existing data, exact indexes/unique constraints and validator definitions, then separate migration privileges from the application's narrower runtime identity where practical. Fail closed on missing financial constraints; do not skip validation to make deployment boot. Coordinate old-worker shutdown/protocol versions. **Tests:** empty/pre-existing schema, duplicate/corrupt legacy rows, restricted credentials, permission-denied setup, partial setup restart, index drift and migration rollback/restore.

Official MongoDB documentation states [collMod is supported on Atlas](https://www.mongodb.com/docs/v8.0/reference/command/collmod/). It is incorrect to call it categorically unsupported on M0. Updating validation rules requires appropriate privileges, commonly dbAdmin ([Compass access table](https://www.mongodb.com/docs/compass/connect/required-access/)). Actual Atlas roles, collection validation expressions and startup were **not tested** here.

### M7 — Aggregation and repeated refresh need an M0 workload budget

**Severity/status:** Medium; performance risk, not a measured bottleneck. `backend/src/repositories/group-balance.repository.js:19-123` checks and aggregates the group's entire expense/settlement history, including receipt validation. `backend/src/repositories/dashboard.repository.js:14-27` facets a full reporting period and sorts recent rows within the facet; `backend/src/repositories/transaction.repository.js:73-86` performs escaped, unanchored case-insensitive title regex search with a time bound. `frontend/src/pages/GroupWorkspace.jsx:28-44` fetches group, roster and balances on refresh/focus, even outside the balances tab. Limits prevent unbounded response arrays, not necessarily cheap database scans.

**Solution/difficulty:** Medium. Measure representative explain plans, latency and scanned rows before adding indexes. Defer expensive balances until needed where UX permits, coalesce refreshes, and use cycle scoping/immutable close summaries only with an integrity/invalidation design. Do not add every filter-combination index or cache private finances in a shared CDN. **Tests:** large receipt-heavy groups, long period/history, duplicate sort keys, literal regex metacharacters, rapid focus/tab changes, query timeout and memory-limit failures.

### Hosting acceptance matrix (not deployment instructions already applied)

| Concern            | Assessment / required release gate                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel             | Select frontend build root while retaining `../shared` build inputs; serve dist, route `/api/*` to Express before SPA fallback, and test actual response headers/cookies. No checked-in hosting configuration yet.                                                                                                                                                              |
| Express hosting    | `server.listen(config.port)` binds without a localhost-only host, and PORT is validated. Use `npm start`, not nodemon; install production dependencies for runtime. Pin Node 24 in the hosting service/build environment.                                                                                                                                                       |
| Free service sleep | Official [Render documentation](https://render.com/docs/free) says idle services sleep after 15 minutes and wake on new traffic, with a cold-start delay. The 10-second Axios timeout (`frontend/src/services/api.js:18`) can therefore expire before waking completes. Show retryable readiness guidance; never automatically replay uncertain mutations.                      |
| Recurring work     | Startup tick plus bounded one-minute timer (`backend/src/jobs/recurring.job.js:2-12`; `backend/server.js:73`) catches up only while the process runs. It cannot execute at scheduled instants while asleep. No external paid scheduler is necessary for correctness; timeliness remains explicitly best effort.                                                                 |
| Atlas M0           | Current [Free-cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) list MongoDB 8.0, 0.5 GB including indexes, 100 ops/sec, 500 connections, a 32 MB sort limit and no temporary aggregation disk spill. Workload fit and exact permissions need staging verification. Local standalone compatibility does not prove Atlas failover behavior. |
| Network/secrets    | Use host-managed server secrets for MONGO_URI/JWT_SECRET and exact HTTPS CLIENT_ORIGIN; only public API configuration belongs in VITE variables. Restrict Atlas network access to the host's documented egress where feasible; document risks if broader access is unavoidable. No real .env was read.                                                                          |
| Headers/cache      | Apply SPA CSP, no-referrer, anti-framing and other appropriate hosting headers; API Helmet does not cover static Vercel HTML. Start CSP in report-only mode with secret-safe reports, then enforce after testing. API proxy must preserve no-store and conditional headers.                                                                                                     |
| Readiness          | `/api/health` is liveness only (`backend/src/controllers/health.controller.js:1-6`). Add a separate bounded DB/schema readiness check; retain liveness independence. Exercise DB loss/recovery and cold start.                                                                                                                                                                  |
| Operations         | Export/restore, migration rollback, secret rotation, reservation investigation and incident ownership require explicit runbooks. Avoid force-unlock scripts and indiscriminate database cleanup.                                                                                                                                                                                |

The official [Render Node-version guidance](https://render.com/docs/node-version) supports explicit runtime selection. The local Node version/build succeeded, but neither cloud provider configuration nor their cookie/proxy behavior was exercised. Free-tier quotas and terms can change; recheck before release.

## 9. Dependencies, tooling and technical debt

### M5 — Development dependency advisory chain

**Severity/status:** Medium engineering priority; verified dependency finding, advisory severity High. `backend/package-lock.json:462-470,542-551,1823-1830` resolves braces 3.0.3 through chokidar 3.6.0/nodemon 3.1.14. Full npm audit reported three entries (`braces`, `chokidar`, `nodemon`) for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), one dependency chain rather than three independent production exploits. Deeply nested attacker-controlled glob patterns can exhaust the stack; no runtime finance route importing this chain was found. `backend/package.json:8-9,34-38` confines nodemon to development; production audit is clean.

**Solution/difficulty:** Low–Medium. Evaluate compatible upstream remediation, a reviewed targeted override with watcher tests, or Node's built-in watch mode. The audit suggests a major downgrade to nodemon 1.14.10; do **not** blindly apply it or `npm audit fix --force`. **Tests:** watcher restart/ignore behavior, development startup, full audit, lockfile reproducibility and production dependency exclusion. No upgrade was performed.

### L1 — validateSync warnings and middleware parity

**Severity/status:** Low; reproduced technical debt. `backend/tests/transaction.test.js:21-121,186-194` calls validateSync. This run logged 95 deprecation warnings. Installed Mongoose's `lib/document.js:3521-3547` explicitly says it skips validation middleware and will be removed in Mongoose 10; [upstream discussion](https://github.com/Automattic/mongoose/issues/16291) confirms the migration direction. Production repository writes use awaited validate/save, so this is not evidence that production skips hooks.

**Solution/difficulty:** Low. Convert model assertions to awaited validate using assert.rejects where appropriate; add explicit provenance/pre-validation hook assertions (`backend/src/models/transaction.model.js:62-65`). Do not suppress warnings globally or upgrade Mongoose's major version just to hide them. **Tests:** preserve current boundary cases, ensure async hooks execute, warning-free backend run and equivalent pass/fail outcomes.

### M9 — Release validation is manual and shared code is outside package checks

**Severity/status:** Medium; verified repository tooling/coverage gap. No tracked `.github` workflow or reusable automated browser harness is present. `backend/package.json:6-12` and `frontend/package.json:6-14` supply separate package commands; both lint commands run in their package directory. `frontend/vite.config.js:33-36` uses jsdom/API mocks. `shared/` is a sibling, so ordinary package lint/format checks do not inspect it. Integration tests use the real engine but are separate and local-only (`backend/integration/settlements.mongo.js:20-34`). Their name-only admin listing/long disposable names are not a ready-made restricted Atlas test runner.

**Solution/difficulty:** Medium. Add one root verification entry point and CI using Node 24, npm ci, explicit shared-code lint/format, unit tests/build/audits, and an ephemeral local MongoDB integration job. Add a reproducible browser suite with isolated databases/cleanup; retain permissions/no-secret logging boundaries. Review integration DB-name limits/credentials before any optional Atlas test, rather than pointing existing local scripts at real data. **Tests:** clean checkout, wrong Node, intentional shared-code failure, failed-job cleanup, concurrent CI runs, lost-response/idempotency and hosted-cookie smoke flows. Do not infer coverage percentage from test counts.

### L4 — Dense financial code and protocol duplication

**Severity/status:** Low; maintainability risk/optional improvement. Several critical modules compress validation/query/update branches into single lines (`backend/src/repositories/group.repository.js:25-54`, `backend/src/services/group-expense.service.js:59-112`, `backend/src/services/recurring-engine.service.js:11-39`). Backend has no configured package-wide Prettier script (`backend/package.json:6-12`). Multiple DTO/ETag/parser/error patterns exist across services. The group record form separately intercepts browser history, while personal forms already use router blockers.

**Solution/difficulty:** Low–Medium. Adopt consistent backend/shared formatting and extract small, proven common protocol helpers only after behavior tests cover them. Keep full-document business validation in services/repositories. Avoid a new generic financial framework. **Tests:** zero behavior-diff formatting commits, existing HTTP/error/ETag tests, router draft protection and explicit shared utility checks.

### Bundle and version compatibility

Local npm trees, tests and Vite build succeeded on Node 24.21.0; no installed top-level incompatibility was reported. This is stronger evidence than guessing from version numbers, but does not establish every peer package's future upgrade compatibility. Both packages restrict Node to >=24 <25, and `.nvmrc` selects 24.

Current measured JS chunks (minified / gzip, decimal kB):

| Chunk                      | Size            |
| -------------------------- | --------------- |
| index                      | 251.09 / 85.32  |
| react-runtime              | 218.76 / 68.27  |
| validation                 | 87.33 / 24.85   |
| DashboardCharts (deferred) | 374.59 / 108.02 |
| GroupWorkspace (deferred)  | 31.92 / 9.56    |

Routes are already lazy (`frontend/src/App.jsx:10-34`), charts are separately lazy, and Vite splits React/Zod (`frontend/vite.config.js:20-30`). The main index chunk alone is **not** the entire initial download: static shared chunks and CSS/fonts also matter. Earlier approximately 558 kB reports are historical, not today's entry measurement. No Lighthouse, low-end-device timing, transfer waterfall or unused-code analysis was executed. Keep the current splitting; measure the production waterfall before chasing negligible reductions or changing warning thresholds.

## 10. Proposed Phase 5 implementation order

1. **Phase 5 Step 2: Financial retry and release-safety hardening.** Resolve H1 with durable intent receipts and conservative UI outcomes; add root/CI shared-code checks and targeted nodemon/validateSync remediation (M5/M9/L1). Preserve contracts through explicit versioned additions and regression tests. This is the recommended next coding milestone.
2. **Cycle architecture specification and acceptance tests.** Approve H2's cycle, correction, archival and owner-succession policies before implementation. Do not unlock legacy groups. Implement cycles as a separately reviewed financial feature after retry hardening.
3. **Operational financial recovery/backups.** Resolve H5/M2 with a tested runbook, safe diagnostics and disposable restore drill. Add bounded, fair backfill policy (M3). Do not require continuous uptime for correctness.
4. **Deployment staging gate.** Implement and verify H3/H4/M4/M8: same-origin API proxy, SPA routing, HTTPS cookies, trusted proxy mapping, Atlas validators/indexes with least privileges, secret/log controls and readiness. No public real financial data until the backup and cookie/authorization gates pass.
5. **Controlled UX/accessibility pass.** Carry every checklist item in section 7 forward, starting with error/focus/draft recovery. Address M1 through an explicit pending cancellation policy, not ad hoc deletion. Add server settlement filters if justified.
6. **Performance and release rehearsal.** Measure M0-scale queries, production network/bundle timing and 320–1440px browser flows, then optimize demonstrated bottlenecks. Run all existing/new tests, integration races, two-cycle accounting and restore tests; approve production separately.

This order is a recommendation, not authorization to implement any feature in this read-only audit.

## 11. Risk and regression acceptance requirements

A release should explicitly record pass/fail evidence for:

- **Money:** safe integer/overflow cases, exact splits, UTC boundary reconciliation, malformed stored data failing closed, budgeted/unbudgeted reconciliation and zero-sum group totals.
- **Retries/crashes:** unknown create outcomes, receipt retention after deletion, concurrent/delayed workers, immutable expense freeze, confirmation retry safety, interrupted reservation/release and restore/replay. A controlled mocked failure is not an OS kill or Atlas failover test.
- **Isolation:** three actual registered accounts; owner/member/outsider access; no personal/group double counting; session changes do not reveal prior-user cached data or drafts.
- **Web security:** deployed SameSite/HTTP-only/Secure cookie behavior, exact Origin/CSRF, proxy IP spoof resistance, cache isolation, secret-redacted invitation access logs, CORS conditional headers and TLS.
- **Lifecycle:** explicit no-unlock legacy migration, pending-capacity behavior, no ownerless group, historical identity preservation and no silent settlement correction.
- **UX:** keyboard/focus/assistive-technology checks, uncertain outcomes, first-settlement warning, route/chunk errors, full reload/auth invitation flow, large amounts and every target width.
- **Operations:** independent backup/restore, startup permissions/schema drift, startup/shutdown interruption, bounded catch-up after sleep, visible unresolved financial operations, reproducible CI and cleanup.

Only this audit document was created. The clean unit/build/lint results do not supersede the unexecuted live-database, browser, hosted-authentication and operational acceptance gates above.
