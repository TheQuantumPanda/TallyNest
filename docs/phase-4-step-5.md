# Phase 4, Step 5 — Collaborative finance frontend

## Implemented experience

Authenticated routes `/app/groups`, `/app/groups/:groupId` and
`/app/join/:token` use the existing application shell and mobile navigation.
The workspace separates overview, expenses, members, balances, settlements and
owner-only invitations. Personal finance pages retain their existing behavior.

Group creation, bounded listing, owner metadata editing and eligible deletion
use the existing APIs. The roster exposes names, stable IDs, roles and joining
dates, never private emails. Only eligible ordinary memberships can leave or be
removed. Currency is INR throughout.

## API integration

Dedicated services validate actual response envelopes with Zod. They share the
existing Axios client, cookie credentials, mutation CSRF header and session-loss
handler. Group, expense and settlement detail responses must carry the expected
`"tn-<id>-v<version>"` ETag. Conditional mutations send that exact If-Match value.
Group deletion follows its existing contract without inventing a precondition.

| Resource    | Existing endpoints used                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Groups      | GET/POST `/groups`, GET/PATCH/DELETE `/groups/:id`                                                                                               |
| Membership  | GET `/groups/:id/members`, DELETE `/groups/:id/members/:userId`, POST `/groups/:id/leave`                                                        |
| Invitations | GET/POST `/groups/:id/invitations`, DELETE `/groups/:id/invitations/:invitationId`, GET `/invitations/:token`, POST `/invitations/:token/accept` |
| Expenses    | GET/POST `/groups/:id/expenses`, GET/PATCH/DELETE `/groups/:id/expenses/:expenseId`                                                              |
| Balances    | GET `/groups/:id/balances`                                                                                                                       |
| Settlements | GET/POST `/groups/:id/settlements`, GET `/groups/:id/settlements/:settlementId`, POST `…/:settlementId/confirm` or `/reject`                     |
| Recovery    | POST `/groups/:id/financial-recovery`                                                                                                            |

All paths above are relative to `/api`. Pagination uses the server's bounded
`after`/`nextAfter` contract, initially 20 records. Expense cursors remain opaque.
Load More deduplicates IDs, preserves server order and prevents overlapping page
requests. Group changes and refreshes invalidate older responses using abort
signals and request generations. Settlement status views explicitly filter
**loaded records**, since the backend has no status query filter.

## Exact splitting and amounts

The existing pure split algorithm now resides in `shared/split.js`; the backend
wrapper retains its Zod validation and delegates to it. The browser imports the
same allocation algorithm for previews. Equal splits distribute remainders in
stable user-ID order; percentage splits use BigInt largest remainders and ID ties;
exact splits must reconcile. Zero-paisa beneficiaries are rejected.

Existing decimal-string money utilities convert input directly to integer paise,
without parseFloat or floating-point multiplication. Percent input is converted
to integer basis points; the total must be 10000. Persisted server shares remain
authoritative. Group expenses never become personal transactions or budget data.
Balances and debt suggestions come from the server; the browser does not rebuild
them from a partial ledger.

## Drafts, concurrency and uncertain outcomes

Forms retain drafts after 428/412/409 errors. Reload-and-review displays the
latest record; explicitly keeping the draft adopts the newly reviewed ETag.
There is no silent overwrite or automatic mutation retry. Dialog closing and
page unloading warn about unsaved edits.

Expense and settlement creation generate a UUID once for each intended payload.
An uncertain response freezes the original validated payload and key for an
explicit identical retry. This remains true if the original request already
reserved settlement capacity. Known changed submissions receive a new key.
Idempotent replay is distinguished from fresh creation. Keys are held in memory;
a full reload loses an unfinished intent, so inspect authoritative history and
recover pending operations before submitting a new one.

Group and invitation creation lack backend idempotency receipts. Their uncertain
outcomes block duplicate submission and require reviewing refreshed records.
Settlement decisions with uncertain outcomes require fetching and reviewing the
latest record; terminal records cannot be submitted again automatically.

## Invitation capability handling

Owners choose supported expiry/use bounds, receive a frontend invitation URL once,
and can copy it or revoke metadata records. Plaintext tokens stay in component
memory, never localStorage/sessionStorage or logs. Closing generation discards the
link; the interface explains it cannot be retrieved again.

Anonymous invitation navigation moves the capability into a login/registration
URL fragment, preserving full reloads and cross-form navigation without persistent
storage. Authentication returns to explicit inspection and acceptance; loading a
page never accepts an invitation. Successful acceptance or unavailable inspection
replaces the token-bearing route. The app sets a global no-referrer meta policy
and adds no analytics or third-party requests.

Production hosting must serve SPA routes correctly, use the configured HTTPS
cookie/origin deployment, and redact invitation paths from access logs. An initial
shared URL necessarily reaches the frontend host; a browser meta tag cannot
control that host's logging. Treat copied links and clipboard contents as secrets.

## Permanent restrictions and recovery

Financial history permanently blocks group deletion and member departure/removal,
even after deleting the last expense. The workspace explains this and retains
non-destructive navigation. The first valid settlement proposal permanently
freezes all expense creation/editing/deletion. A first-proposal checkbox explicitly
acknowledges that policy. Rejection does not unlock expenses. There is no reversal,
archive, owner transfer or force-unlock control.

Only intended recipients see pending settlement decision controls. Confirmation
states that acknowledgement in TallyNest does not verify an external bank payment.
Positive net positions mean money is owed to the member; negative positions mean
the member owes money. Pending reservations are shown separately. Suggestions are
deterministic, not guaranteed globally minimal, and never execute payments.

FINANCIAL_BUSY suppresses financial summaries and presents one explicit bounded
recovery attempt. The owner or original actor can request it; the backend verifies
permission. The DTO does not expose the reservation actor, so ordinary members are
shown a clearly labeled recovery action for their own operation. There is no
unbounded retry loop and no unresolved operation is presented as completed.

## Components and accessibility

Services live in `frontend/src/services/group*.js`; request lifecycle hooks are in
`hooks/useGroupData.js`. Pages compose focused components in `components/groups`
for records, forms, invitation links, roster, allocations, balances, settlements
and recovery. `styles/groups.css` extends existing dark surfaces and mint accents.
Native modal infrastructure retains focus management and restoration. Forms use
labels, associated errors, status announcements, keyboard controls and textual
financial statuses. Existing reduced-motion preferences remain respected.

## Verification and limitations

Executed verification: 240 frontend tests (19 files), 296 backend unit/HTTP tests,
and 145 real MongoDB integration tests passed. Both package ESLint checks, the
configured frontend Prettier check, explicit shared-code/document formatting,
production build and both production dependency audits passed (zero vulnerabilities).
`git diff --check` passed. No dependencies were added.

Real Chromium used three registered accounts against Express and disposable MongoDB.
It exercised group creation, invitation authentication/reload/acceptance, member
privacy and outsider denial, equal/exact/percentage expenses, a lost-response
idempotent retry, stale expense review and retry, deletion, interrupted-operation
recovery, settlement proposal/confirmation/rejection, permanent expense freezing,
refresh persistence, personal-finance isolation and session-loss redirection.
All four widths (1440, 1024, 390, 320) had no page-level horizontal overflow; mobile
navigation opened and closed correctly. Two browser databases were dropped and
verified absent afterward. Metadata editing, unlocked membership departure and
invitation revocation were covered by automated tests, not separate browser flows.
Screenshots
are stored under `output/playwright/groups-balances-{1440,1024,390,320}.png` and
`output/playwright/groups-recovery-1440.png`.

There is no realtime push synchronization: mutations refresh the workspace, and
Refresh workspace retrieves authoritative changes from other members. Backend
best-effort summary consistency and explicit recovery constraints still apply.
History is bounded; loaded settlement filters do not claim collection-wide search.
No payments, reversals, notifications or personal-finance synchronization are added.
