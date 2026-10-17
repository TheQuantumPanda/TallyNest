# Phase 5, Step 3G — settlement-cycle frontend integration

## Activation and scope

The cycle workspace is a **staged, test-only frontend**. The normal `frontend/src/main.jsx` and `frontend/src/App.jsx` do not import it. The normal Express `backend/app.js` and `backend/server.js` do not register the version-2 router. A browser URL, query string, storage value, or group DTO cannot activate either side. Production builds retain the legacy group experience, including its global settlement freeze. No database migration or maintenance release is performed here.

The separate `frontend/src/cycle-test/main.jsx` entry is served through `frontend/vite.cycle.config.js` on port 5174. Its backend is the explicitly invoked `backend/integration/cycle-ui-server.js`, which requires `NODE_ENV=test`, `TALLYNEST_CYCLE_FIXTURE=disposable-local`, a private test password, and local MongoDB. It generates a unique `tallynest_cycle_http_test_*` database, uses the Step 3F disposable Express composition, creates only disposable registered accounts and a protocol-2 fixture group, and drops that database on SIGINT/SIGTERM. The fixture refuses a nonlocal MongoDB URI. This is not a production activation switch: the normal server never imports this file or registers staged routes. The Step 3F readiness preflight still rejects held maintenance, missing indexes/validators, inconsistent protocol state, and unresolved operations. Operators must not run this fixture against real financial data.

## Frontend modules

| Module                                                                      | Responsibility                                                                                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/services/cycles.js`                                           | Strict version-2 Zod envelopes, group head and resource ETags, scoped cursors, explicit cycle IDs, lifecycle intent preservation, expense/settlement adapters and recovery. |
| `frontend/src/pages/CycleWorkspace.jsx`                                     | Group and selected-cycle loading, permission and state controls, current versus historical navigation, authoritative refresh, and recovery entry point.                     |
| `frontend/src/components/cycles/CycleHistory.jsx`                           | Paginated, accessible cycle selection; browser history stores the selected cycle in the path without moving the group pointer.                                              |
| `frontend/src/components/cycles/CycleTransition.jsx`                        | Owner-only first-open, freeze, close and next-open confirmations, fixed UUID/body/ETags/epoch, identical explicit retry and conflict review.                                |
| `frontend/src/components/cycles/CycleRecordOverlay.jsx`                     | Latest detail/ETag fetch before authorized expense edit/delete or recipient settlement decision.                                                                            |
| Existing group expense, settlement, balance, invitation and form components | Reused through injected cycle-scoped services and an explicit `cycleId`; their legacy defaults remain unchanged.                                                            |

The test-only entry includes login, registration, groups, invitation landing, and cycle workspace routes under the existing authenticated layout. It is a deliberately limited composition: unrelated personal-finance navigation links are not part of this fixture. The normal application continues to provide those pages through its original entry.

## Version-2 API handling

The adapter requires `status: ok`, `apiVersion: 2`, `data.group`, and a matching `X-Group-ETag` on every successful response. Cycle, expense, settlement, and balance DTOs have explicit Zod schemas. Single-record responses must carry the matching resource ETag. The adapter rejects a resource from a different group or cycle, duplicate page IDs, invalid currency/paise, malformed pagination, and nonzero aggregate net balance. Private operation payloads, hashes, checkpoints and maintenance fields are not retained in UI state.

Financial creation always sends an explicit `cycleId` and one UUID `Idempotency-Key` per intended request. The existing `RecordForm` preserves the original payload and key for an explicit retry after an uncertain outcome. A changed draft starts a new intent only after review. The lifecycle dialog additionally preserves the original group and cycle ETags, epoch, body and path in memory; it never substitutes a newer ETag into an uncertain retry. Missing/stale preconditions (`428`/`412`/`409`) require review, not a blind resubmission. Memory-only intent state is lost on a full browser reload, so users must inspect authoritative records before starting another intent. No financial draft or invitation token is placed in persistent browser storage.

The cycle selector and both financial ledgers use the backend's signed, scoped `after` cursor and bounded `limit`. Changing group/cycle remounts the relevant page resource and invalidates older requests. The settlement status tabs filter **loaded pages only**, because the staged API has no status query; the UI says so and offers Load More. Balance figures and suggestions come only from the explicit cycle-scoped balances endpoint, never from loaded ledger pages. Empty Cycle 2 starts at genuine zero positions; Cycle 1 history remains read-only. Exact display and split preview use the existing integer-paise formatter and shared pure split implementation. Server-saved shares remain authoritative.

## Lifecycle, membership and recovery UX

Only authoritative group owners see lifecycle controls. First open snapshots members. Explicit freeze and the first valid proposal permanently freeze that cycle's expense writes; rejection does not thaw it. Close requires exact zero balances and no pending proposals, as enforced by the server. Next open is a separate action and never carries debt forward. Closed/historical cycles cannot create, edit or delete expenses or decide settlements. Settlement confirmation records recipient acknowledgement, not external payment verification.

The member tab shows the immutable cycle snapshot and distinguishes it from the current roster. The owner invitation tab uses the existing one-time link workflow. Admission is allowed only after the current cycle closes and before the next opens; the backend enforces this even if a link is shared while a cycle is open. Historical member IDs remain visible for attribution, while backend authorization governs detail access. Existing permanent financial-history restrictions on departure/removal and the lack of owner succession remain. A later-joining member denied historical balance access sees a restricted-history message.

Busy financial operations expose one explicit recovery action. It invokes the staged recovery endpoint once, then reloads the group, cycle and financial resources. It cannot force-unlock a reservation or override a held migration. Uncertain responses are not shown as committed transitions. A full reload may be needed after session expiry; the existing auth context redirects to login.

## Local disposable browser review

Start local MongoDB, then run these **only** for disposable review:

```bash
docker compose up -d --wait mongodb
cd backend
NODE_ENV=test TALLYNEST_CYCLE_FIXTURE=disposable-local \
  TALLYNEST_CYCLE_FIXTURE_PASSWORD='<private disposable password of at least 16 characters>' \
  node integration/cycle-ui-server.js
```

In another terminal:

```bash
cd frontend
VITE_API_URL=http://localhost:5007/api npm run dev -- --config vite.cycle.config.js
```

Open `http://localhost:5174`. The fixture prints its disposable group ID and test database name. Sign in as `cycle-owner@test.invalid` or `cycle-member@test.invalid` with the supplied disposable password; additional accounts may be registered through the fixture. Shut down the fixture gracefully so it drops its database, then independently verify that no disposable database remains. The normal development application stays on ports 5000/5173 and never serves version 2.

The Chromium walkthrough on a disposable local MongoDB verified login, Cycle 1 expense and settlement history, recipient confirmation, exact zero balances, closure, Cycle 2 opening, a persisted exact-split Cycle 2 expense, historical Cycle 1 read-only controls, session-expiry redirect, and no page-level horizontal overflow at 1440, 1024, 390 and 320 pixels. Review captures are under `output/playwright/cycle-*.png`. This was a manual fixture walkthrough, not a reusable browser CI gate. It did not exercise a full three-account invitation admission sequence, every split method, process-kill recovery, or production/Atlas deployment. The backend's dedicated MongoDB suites cover more concurrency and fault boundaries.

## Staged API compatibility repair

Live settlement listing/detail initially returned `422` after a valid proposal: direct validation of a query-returned Mongoose settlement carried a transient immutable-currency error. The staged read adapter now validates a fresh document snapshot with the same model rules and still fails closed for corrupt data. It does not alter the model or financial write protocol. The real MongoDB staged HTTP suite now asserts pending and confirmed list/detail reads.

## Remaining release gates

- Run a coordinated, separately reviewed migration and cutover with all old writers stopped, readiness verified under actual runtime privileges, and maintenance held until approval. No such action is performed in this milestone.
- Build a reusable secure browser test harness and complete the three-account invitation, recovery, split-method, full-reload intent, and cross-account navigation matrix before public activation.
- Decide future historical-cycle access for later-joining members; the existing backend snapshot restriction is preserved.
- There is no settlement reversal, owner succession, financial member departure, payment verification, automatic transfer, or Atlas/production browser verification.
