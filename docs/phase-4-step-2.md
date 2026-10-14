# Phase 4, Step 2 — Invitations and membership management

> Current policy: [Phase 4, Step 4](phase-4-step-4.md) supersedes pre-settlement
> expense mutation semantics. Financial history permanently blocks group deletion
> and member departure. The first valid settlement proposal freezes expense creation,
> editing and deletion, with durable serialization and explicit crash recovery.
> Historical verification counts below describe that step's original execution.

> Current policy update (Phase 4, Step 3): groups permanently marked with financial
> history cannot be hard deleted, and their members cannot leave or be removed.
> These restrictions are enforced in database write predicates before the first
> shared expense insertion. Deleting every visible expense never clears the lock.
> See [the shared expense specification](phase-4-step-3.md) for concurrency, conservative
> failed-creation locks and updated deletion behavior. Earlier policies below describe
> this document's implementation snapshot and apply only to unmarked groups.

Implemented on 2026-10-13. Backend-only: invitation links for registered accounts,
member listing, owner removal and voluntary member leaving. No shared expenses,
balances, splits, settlements, email delivery or frontend pages are added. Existing
personal transaction, budget, dashboard, recurring and authentication contracts stay intact.

## Architecture and atomic acceptance

Invitations are **bounded embedded records within the existing Group**, with their
own schema/repository/service/controller. This is an intentional alternative to a
separate collection: invitation consumption, the new membership and group version
can commit in one atomic document update on standalone MongoDB. It avoids a
cross-document claim window, pending-membership state, lease, cleanup journal or
replica-set transaction assumption. The containing group provides the single group
reference, and deleting that document removes all invitation capabilities atomically.

This keeps the Step 1 embedded memberships (maximum 100), original creator and
exactly one owner. Invitations are limited to 50 retained records per group and
1–20 distinct accounts per invitation. The bounds keep documents and work small;
large groups or long-term invitation audit history may eventually justify a separate
collection with a new explicitly recoverable acceptance protocol. No such migration
or scheduling infrastructure is implemented here.

Acceptance reads a token-hash match, then performs one atomic aggregation-pipeline
update with the following **database predicates**:

- Same group ID and current `__v` version.
- Same embedded invitation ID/hash, no revoked marker and no receipt for this account.
- Invitation creation time is no later than MongoDB `$$NOW`; expiration is strictly
  later than `$$NOW`, and receipt count remains below maxUses.
- Account is not already a group member; there are fewer than 100 members.

The update appends a fixed-role `member` with joining date and a matching acceptance
receipt with the same MongoDB timestamp, then increments `__v`. Collection validation
rechecks membership uniqueness/sole-owner and invitation constraints. It cannot grant
owner privileges or overwrite metadata. A CAS race is never blindly retried by the
service: current state determines invalid/duplicate/full versus 409 conflict.

### Crash recovery and durability

There is no separate invitation claim and membership-insertion step to interrupt.
Before the write, neither effect exists. After commit, both exist. Journaled-majority
acknowledgement uses the existing durable-write utility (two-second write-concern
timeout); unknown commit outcomes remain safe to reconcile/retry. Reads by token use
majority read concern. No MongoDB multi-document transaction or replica set is needed.

If the response is lost after commit, a retry returns 409 ALREADY_MEMBER and does not
consume another use. Clients should read their groups/member state to reconcile rather
than infer failure from a timeout. A retained receipt returns ALREADY_ACCEPTED after
the account has left/been removed, preventing an old invitation from resurrecting
membership. A newly issued invitation may deliberately permit rejoining.

Fault injection tested failures before the write and after commit, then fresh service
instances against persisted MongoDB state. Actual OS termination, power loss and
replica-set failover were not tested. Database-clock predicates ensure expiry/revocation
changes between service read and insertion cannot be bypassed. Application/database
clocks should be synchronized: the service uses UTC for initial checks/creation, while
MongoDB's UTC clock is authoritative at acceptance commit.

## Data models and constraints

The membership schema is unchanged: `user` (User ObjectId), `role` (owner/member)
and `createdAt`. No second identity system or personal financial schema is introduced.
Creation/acceptance use the authenticated live registered account; no body email/user
identity is trusted. Future account deletion still needs explicit historical policy,
since MongoDB references are not foreign keys.

New optional `Group.invitations` array (legacy groups may omit it):

| Field | Storage / meaning |
| --- | --- |
| `_id` | Stable embedded invitation ObjectId |
| `tokenHash` | Immutable lowercase SHA-256 hex digest; no plaintext secret |
| `createdAt` | UTC BSON Date |
| `expiresAt` | UTC BSON Date, strictly after creation, at most seven days later |
| `maxUses` | Integer 1–20; default request value 1 |
| `revokedAt` | Optional UTC BSON Date; presence makes invitation unusable |
| `accepted` | Bounded durable receipts `{ user: User ObjectId, acceptedAt: UTC BSON Date }` |

Used count derives from receipt count, avoiding a second counter that can drift.
Receipt users must be unique within an invitation, count cannot exceed maxUses, and
receipt timestamps satisfy `[createdAt, expiresAt)`. Removal does not refund uses or
delete receipts. Invitation IDs/hashes must be unique inside each group. Mongoose
and the strict MongoDB validator enforce bounds/types/uniqueness and reject plaintext
secret fields or unsupported stored properties. The existing owner/member constraints
remain enforced. No speculative balance fields are added.

Indexes:

```js
{ _id: 1 } // implicit group identity
{ 'members.user': 1, _id: -1 } // existing scoped group listing
{ 'invitations.tokenHash': 1 } // new unique sparse multikey index for capability lookup
```

The unique index prevents hash reuse across groups; collection-validation set rules
also prevent duplicates inside one embedded array (a multikey unique index alone
cannot enforce that). Sparse indexing supports groups without invitations. No role,
email, public-user search or extra financial indexes are introduced. Existing startup
`ensureGroupIndexes` installs the extended strict collection validator and index before
traffic; createCollection/collMod/index privileges remain required. The validator is
compatible with legacy groups whose invitation field is absent.

## Token security and expiry

Node `crypto.randomBytes(32)` supplies 256 unpredictable bits, encoded as a canonical
43-character base64url token. SHA-256 hashes the exact token string. Random entropy,
not a human password, makes an unkeyed hash appropriate; no new server secret is
needed. Malformed/noncanonical tokens are rejected before lookup with the same generic
404 response as invalid/revoked/expired/exhausted tokens or a deleted group.

Token and token-containing paths appear **only in the owner's successful creation
response** for private manual sharing. Metadata lists, inspection, acceptance and
member responses contain no tokens or hashes. Token values are not logged by the
application, and unexpected errors are sanitized. There is no plaintext token
persistence, automated email or refresh workflow. Inspection and acceptance require
an authenticated registered account; possession of a token is a limited join/inspection
capability, not general roster/private-description access.

The token may necessarily appear in the requested URL. Anyone operating access logs,
reverse proxies or external tracing must redact `/api/invitations/:token` paths and
avoid logging creation response bodies. Links should be shared privately, never
committed, posted publicly or included in analytics. Responses use no-store and
Referrer-Policy no-referrer. There is no frontend invitation landing page yet; manual
sharing uses the returned inspectionPath prefixed with the backend's origin.

Creation accepts relative expiry seconds: default 86400 (24 hours), minimum 60,
maximum 604800 (seven days). Validity is half-open `[createdAt, expiresAt)`; exactly
at expiresAt is expired. Expiry is checked explicitly, independent of cleanup.

There is **no TTL index** on the embedded date, because TTL would delete the entire
group. On the next owner invitation creation, expired/revoked records are pruned
under the group version CAS before adding a new invitation. Exhausted records remain
until expiry/revocation, preserving duplicate-use receipts. Groups with no subsequent
invitation creation retain inactive metadata, but the 50-record bound prevents
unbounded growth and inactive tokens cannot be accepted. Deleting a group removes
all records; no orphan separate collection needs cleanup.

Owner metadata status precedence is revoked → expired → exhausted → active. It includes
id, creation/expiration dates, maxUses and usedCount, but not accepting account IDs.

## API contracts

All endpoints require the existing JWT cookie and live account lookup. Mutations
require exact configured Origin and X-CSRF-Protection: 1; POST requires JSON.
New request bodies/queries are strict Zod schemas. Existing CORS permits If-Match and
exposes ETag; every new response is Cache-Control no-store.

| Method | Path | Authorization / requirements | Success |
| --- | --- | --- | --- |
| POST | `/api/groups/:id/invitations` | Owner, current group If-Match, JSON options | 201, one-time secret and metadata |
| GET | `/api/groups/:id/invitations` | Owner, no query parameters | 200, metadata list and group ETag |
| DELETE | `/api/groups/:id/invitations/:invitationId` | Owner, current group If-Match | 200, revoked and new group ETag |
| GET | `/api/invitations/:token` | Registered user, token capability, no query | 200, minimal inspection |
| POST | `/api/invitations/:token/accept` | Registered user, token capability, JSON `{}` | 200, joined group and ETag |
| GET | `/api/groups/:id/members` | Group member, no query parameters | 200, public roster and group ETag |
| DELETE | `/api/groups/:id/members/:memberId` | Owner, current group If-Match | 200, member removed and new ETag |
| POST | `/api/groups/:id/leave` | Ordinary member, current group If-Match, JSON `{}` | 200, group left |

Creation body (both fields optional):

```json
{ "expiresInSeconds": 86400, "maxUses": 1 }
```

Example creation response (placeholder secret, not a real token):

```json
{
  "status": "ok",
  "data": {
    "invitation": {
      "id": "507f1f77bcf86cd799439044",
      "createdAt": "2026-10-13T12:00:00.000Z",
      "expiresAt": "2026-10-14T12:00:00.000Z",
      "maxUses": 1,
      "usedCount": 0,
      "status": "active"
    },
    "token": "<one-time base64url secret>",
    "inspectionPath": "/api/invitations/<token>",
    "acceptancePath": "/api/invitations/<token>/accept",
    "group": { "id": "507f1f77bcf86cd799439033", "version": 1 }
  }
}
```

The abbreviated group above actually uses the existing complete public group DTO
(name/currency/optional description, version, caller membership and timestamps).
Its ETag is the updated group version, e.g. `"tn-507f1f77bcf86cd799439033-v1"`.
Invitation listing uses `data: { invitations: [metadata], group }`; max 50 entries,
so no unbounded listing or extra pagination contract is needed.

Inspection response reveals only group ID/name/currency and expiry:

```json
{
  "status": "ok",
  "data": {
    "invitation": {
      "group": { "id": "507f1f77bcf86cd799439033", "name": "Household", "currency": "INR" },
      "expiresAt": "2026-10-14T12:00:00.000Z"
    }
  }
}
```

No description, roster, creator identity, use count or invitation history is disclosed
through inspection. Acceptance body must be `{}`; supplied IDs, emails, roles, versions
or Mongo operators are rejected. Success uses `{ status: 'ok', data: { group },
message: 'Invitation accepted' }`, with caller role member. The inspection endpoint
does not expose a group version; acceptance uses an internal database CAS instead of
requiring a client ETag for a group the account cannot yet read.

Revoke returns `{ status: 'ok', data: { group }, message: 'Invitation revoked' }`.
Owner removal similarly uses `message: 'Member removed'`. Leave returns
`{ status: 'ok', message: 'Group left' }`; it does not return data the caller no longer
has permission to read.

Member listing uses `data: { group, members }`, bounded by 100 memberships. Each row
is `{ id, name, role, joinedAt }`. User lookup projects only `_id` and `name`; emails,
password hashes, tokens and unnecessary profile fields are never returned. Missing
accounts use an explicit `Unavailable account` label. A second member-scoped group
check catches revoked access during profile fetching; changed versions require
reloading rather than returning a stale roster. This is a best-effort current view,
not a cross-collection snapshot or instantaneous revocation barrier for in-flight reads.

### Permissions, versions and errors

Owners alone create/list/revoke invitations and remove ordinary members. Members can
list the roster and leave themselves. No ownership transfer or owner promotion is
implemented; the sole creator-owner cannot leave or be removed. Owner writes enforce
creator/owner-role/user predicates and version at the database level. Leave requires
same authenticated identity, ordinary member role and noncreator predicates in the
write. MongoDB also prevents removing the sole owner directly without bypassing its
validator. Unrelated group IDs retain identical missing-group 404 behavior.

Invitation create/revoke and membership remove/leave use the **group** ETag. They all
increment group version, invalidating old metadata ETags. Missing If-Match is 428,
already stale is 412, malformed/wrong resource is 400 and a later CAS race is 409.
Owner/member authorization and sole-owner protection may fail before version checking.
There are no automatic overwriting retries. Deleted groups invalidate all token reads
and cannot receive a membership, including deletion between inspection and acceptance.

| HTTP / code | Meaning |
| --- | --- |
| 400 INVALID_INVITATION / INVALID_MEMBERSHIP / INVALID_QUERY | Invalid options, identity syntax, protected fields or unsupported query |
| 400 INVALID_VERSION | Invalid If-Match syntax/resource |
| 401 AUTH_REQUIRED | Missing/invalid/expired session or unavailable account |
| 403 GROUP_OWNER_REQUIRED / CSRF_REJECTED | Known member lacks owner privileges, or invalid mutation origin/header |
| 404 GROUP_NOT_FOUND | Missing/inaccessible group |
| 404 INVITATION_UNAVAILABLE | Invalid/malformed/expired/revoked/exhausted/deleted-group token or missing invitation |
| 404 MEMBER_NOT_FOUND | Authorized owner targeted an absent member |
| 409 ALREADY_MEMBER | Account is already in this valid invitation's group |
| 409 ALREADY_ACCEPTED | Account used this invitation previously and is no longer a member |
| 409 GROUP_FULL / INVITATION_LIMIT | 100 members / 50 retained invitation capacity |
| 409 OWNER_PROTECTED | Sole owner cannot leave or be removed |
| 409 GROUP_CONFLICT | Race or safe version exhaustion; reload/review |
| 428 PRECONDITION_REQUIRED / 412 VERSION_MISMATCH | Missing / stale client group version |
| 415 JSON_REQUIRED / 429 RATE_LIMITED | Invalid content type / rate limit |
| 500 INTERNAL_ERROR | Sanitized unexpected failure |

Invalid capability cases share the same 404 body. For an otherwise valid link,
already-member/previous-use checks explain the authenticated caller's own state
before exhausted-use checks; unrelated accounts still receive the generic exhausted
404. Revoked/expired links never reveal membership state through acceptance errors.

Rate limits are 60 invitation-route requests per IP per 15 minutes (before auth),
30 inspections per authenticated user per 15 minutes and 15 acceptance attempts per
user per 15 minutes. The existing group-route 300/user/15-minute limiter covers owner
metadata and member operations. Limits count invalid requests, are process-local,
reset on restart and are not coordinated across multiple instances. Existing proxy
trust remains disabled; future hosting must configure trusted proxies/shared limiting
explicitly rather than trusting spoofable forwarding headers.

## Deletion and future shared-expense boundaries

Hard group deletion now atomically removes memberships **and embedded invitations**.
No invitation remains usable after deletion and no independent invitation records can
be orphaned. Removal/leave remove only that ordinary membership, preserve the creator
owner, retain use receipts and do not refund invitations. They never touch personal
transactions, budgets, dashboard records, recurring templates or generated entries.

These policies **must be revisited before Phase 4, Step 3 shared expense records**.
Outstanding creditor/debtor obligations, historical payer/beneficiary access, departed
members' identity, group archives, settlement auditing and owner succession require
explicit rules before financial records attach to groups. Do not add silent financial
cascades, permit removal to erase debts or mix shared expenses into personal totals.

## Files and verification

New backend files:

- `src/models/invitation.model.js` (embedded schema and MongoDB constraints).
- `src/validators/invitation.validator.js` (options, canonical token, empty input).
- `src/repositories/invitation.repository.js`, `membership.repository.js`.
- `src/services/invitation.service.js`, `membership.service.js`.
- `src/controllers/invitation.controller.js`, `membership.controller.js`.
- `src/routes/invitation.routes.js`.
- `tests/invitation.test.js`, `tests/helpers/invitation-api.js`,
  `tests/helpers/invitation-repository.js`, `integration/invitations.mongo.js`.

Modified: Group model/collection validator/index, group routes, app dependency injection,
error sanitization, reusable group version helper and its existing service integration,
existing group index test assertion, test:mongo script, README and this specification.
No frontend/shared monetary/personal financial schema/environment files were changed;
no dependencies or external services added. Layering remains controller → service →
repository → model, with financial logic untouched.

Executed verification:

| Command | Result |
| --- | --- |
| `npm test --prefix backend` | 269 passed, zero failed/skipped; 18 new invitation/membership tests |
| `npm run test:mongo --prefix backend` | 110 passed, zero failed/skipped; 20 new invitation/membership tests |
| `npm test --prefix frontend` | 165 passed across 15 files |
| Both package ESLint commands | Passed, zero warnings |
| `npm run format:check --prefix frontend` | Passed; backend has no configured Prettier command |
| Both production `npm audit --omit=dev` commands | Zero vulnerabilities |
| `git diff --check` | Passed |

Real local standalone MongoDB 8.0 was confirmed healthy through Docker Compose.
The new suite uses uniquely named `tallynest_invitation_test_*` databases, actual
persisted User accounts, and three additional accounts created through the real
registration API. It exercises token hashing/privacy, collection/hash-index enforcement,
limited-use concurrent acceptance, the final group slot, exact database-clock expiry,
revocation/deletion during acceptance, atomic before/after-write failure recovery,
concurrent metadata/removal version checks, sole-owner protection, retained receipts,
capacity cleanup, member-profile privacy, cross-group isolation and unchanged personal
transaction data. Existing budget/recurring/database regression suites also passed.

Every integration suite drops its disposable database and confirms absence. The final
invitation database was `tallynest_invitation_test_1791901522393_ce4a1daf6fd5`. A separate database-name
inspection confirmed all 10 recorded databases from focused/full runs were absent,
and no invitation test database remained.
No development financial data or `.env` secrets were used/modified. No new frontend
browser walkthrough/build was run for this backend-only step; no such result is claimed.

Known limits: 100 members, 50 retained invitations, 20 uses, max seven-day link lifetime;
no dedicated invitation archive, no automatic email/cleanup scheduler, and no shared
rate-limit store. Expired metadata may remain until owner creation/deletion, but expiry
is always enforced. Single-document membership contention can produce deliberate 409s.
Standalone behavior was executed; Atlas permissions/failover and actual process kills
remain unverified. All changes remain uncommitted for review.
