# Phase 5, Step 2A — Personal finance creation idempotency

This implementation addresses audit finding **H1**, subject to the executed verification below. The original audit remains unchanged. No group/settlement algorithms, scheduling infrastructure, authentication architecture or page design are changed.

## Coordinated endpoint contract

Both `POST /api/transactions` and `POST /api/recurring` now require a UUID `Idempotency-Key`. Authentication, configured Origin, `X-CSRF-Protection: 1`, JSON content type and strict Zod financial validation still apply. Generate one UUID for one intended creation, not one UUID for each HTTP retry.

| Outcome                                                 | HTTP            | Response                                                                    |
| ------------------------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| Newly persisted resource                                | 201             | Existing `data.transaction` or `data.schedule`, plus `data.replayed: false` |
| Identical normalized creation replay                    | 200             | Current resource DTO, current ETag, `data.replayed: true`                   |
| Same owner/resource key with different normalized input | 409             | `IDEMPOTENCY_CONFLICT`                                                      |
| Identical replay after intentional deletion             | 409             | `CREATION_DELETED`; no resurrection                                         |
| Missing, empty or invalid UUID                          | 400             | `IDEMPOTENCY_KEY_REQUIRED`                                                  |
| Unknown database/write outcome                          | Sanitized error | No automatic retry. Explicitly retry the same key and original payload.     |

For example:

```http
POST /api/transactions
Origin: http://localhost:5173
Content-Type: application/json
X-CSRF-Protection: 1
Idempotency-Key: 5b46f217-a027-4fe2-910a-d49ca3bcf292

{"type":"expense","title":"Lunch","amountMinor":10001,"currency":"INR","category":"food_dining","transactionDate":"2026-10-16T00:00:00.000Z"}
```

The success envelope remains `{ "status": "ok", "data": { "transaction": { ... }, "replayed": false } }`; recurring creation substitutes `schedule`. Single-record ETags retain `"tn-<id>-v<version>"`. GET/PATCH response envelopes and If-Match rules are unchanged. No receipt hash, owner, deletion marker or plaintext key is exposed in resource DTOs.

The API compares the original **normalized creation** payload, not the current edited resource. Zod normalizes text, default INR, default schedule status and canonical date strings; hashing explicitly orders field names. UUID text is case-normalized before hashing. Optional absent and explicitly empty text follow the existing schema's normalization; they are not inferred to be the same business intent. Different UUIDs may intentionally create identical legitimate records. The same UUID can be used independently by another owner or for the other resource type.

## Durable receipt and index design

Transaction and RecurringSchedule each add optional immutable `creationKey` and `creationHash` SHA-256 hexadecimal fields. They are created in the **same resource insert** as the business record. There is no cross-document commit gap, reservation collection, Redis or MongoDB transaction requirement.

Each collection adds:

```js
{ owner: 1, creationKey: 1 }
// unique: true
// partialFilterExpression: { creationKey: { $type: 'string' } }
```

Separate collections establish resource-type scope. Startup awaits the existing Transaction/RecurringSchedule initialization, including these indexes, before serving requests. Legacy and generated records without a creation key remain valid and do not collide. There is no key expiry or TTL deletion.

The service reads an owner-scoped receipt first, then validates/saves the resource with majority+journal acknowledgement. Concurrent insertions are arbitrated by MongoDB's unique index. An actual duplicate-key error is reconciled by an owner/key lookup; an unknown write error is propagated safely, never blindly retried. The next explicit identical request discovers the durable receipt. All updates exclude receipt fields, schemas mark them immutable, and strict HTTP schemas reject client-supplied receipt metadata. Privileged raw database writes remain outside application authorization; these indexes do not cryptographically protect against a database administrator rewriting history.

A replay returns the **current** persisted record, including edits, advanced recurrence cursor, pause status and current version. It does not restore the original values. The original payload fingerprint remains immutable, so editing cannot make a changed creation payload eligible for replay.

## Deletion and financial scopes

- New manual transactions with creation receipts are soft-deleted by setting `deletedAt`, retaining the key/hash and original financial document. Generated transaction tombstones and unique schedule/date generation receipts keep their existing semantics.
- Pre-existing manual transactions without a receipt retain their previous hard-deletion behavior. No receipt/key can be inferred retroactively for a creation made through an older API.
- Recurring schedules are now tombstoned on deletion, provided no pending generation reservation exists. Their creation receipt, anchor/cursor and version remain stored; historical generated transactions remain intact.
- Transaction owned reads, bounded lists, dashboard aggregation and budget spending already exclude `deletedAt`; the new tests verify manual receipt exclusion against MongoDB. Receipt lookups deliberately include deleted records.
- Schedule detail/list/due scans and reserve/advance/update predicates exclude deleted schedules. A pending generation operation continues to block deletion. Deleting a template therefore cannot race a new reservation into generating additional entries.
- A deleted UUID cannot be reused to recreate its resource. Changed input with that key is also rejected (fingerprint conflict is checked before deletion status). A consciously new creation requires a new intent key.

Hidden receipts are retained indefinitely. Storage retention/export and eventual privacy policies must preserve idempotency guarantees; deleting tombstones or expiring receipts would reopen resurrection risks. No development data migration or cleanup is performed by this implementation.

## React creation intent behavior

A small shared hook maintains account/resource-scoped intents in JavaScript memory. It keeps the UUID, frozen normalized API payload and form values across modal closing/reopening and SPA route changes. Neither financial drafts nor keys are written to browser storage. Invitation handling is untouched.

Transaction and recurring creation services validate UUIDs, send Idempotency-Key and validate `replayed` metadata. Forms prevent simultaneous saves. After a timeout/network/5xx outcome, inputs are disabled and **Retry identical submission** sends the original payload and UUID. An expired session during a later retry does not discard an already uncertain intent. The existing authentication handler still invalidates the session.

**Close and review existing records** retains the intent and reloads authoritative ledger/schedule/dashboard data without claiming the operation succeeded. To change input/start another intent, the user must explicitly acknowledge that they reviewed existing records and the prior operation may already exist. Replays have a distinct success message and refresh server data.

A definitely rejected initial request permits input correction; an unchanged retry retains its key, while a changed payload starts a new intent. An already uncertain request remains frozen through later errors until explicit review or successful reconciliation.

**Full reload, tab closure or a fresh browser context loses memory-only retry state.** The warning explicitly instructs users to inspect authoritative records before creating again. Separate tabs are independent intents. The backend cannot deduplicate different UUIDs by financial values without rejecting legitimate identical records. No claim is made that memory-only state survives a crash/full reload. Starting a new intent after explicit review is a deliberate user decision, not automatic deduplication.

## Compatibility and rollout

Backend and frontend must deploy together: older clients that omit Idempotency-Key receive 400. Update scripts/API consumers too. Existing resource fields and edit/lifecycle protocols remain available. Internal repository fixtures may still create legacy records without metadata; authenticated creation services require a key.

Stop old backend writers during rollout. They do not know about schedule tombstones and could otherwise scan deleted templates. Back up before production rollout and verify the partial unique indexes before accepting creation traffic. Do not drop existing provenance/date/amount indexes. No dependencies, environment secrets or CI workflows are changed.

## Verification

Executed results and browser evidence are recorded below after the final verification run. Tests remain split between isolated unit/HTTP checks and real disposable MongoDB integration. No normal development financial records are used.

### Executed results — 2026-10-16

| Check                                                                                    | Actual result                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Backend unit/HTTP tests                                                                  | 302 passed, zero failed/skipped (296 existing plus six new) |
| Frontend tests                                                                           | 248 passed across 20 files (240 existing plus eight new)    |
| Real MongoDB integration                                                                 | 155 passed, zero failed/skipped (145 existing plus ten new) |
| ESLint, backend and frontend                                                             | Passed                                                      |
| Configured frontend Prettier check                                                       | Passed                                                      |
| Explicit new backend/test/spec Prettier checks using the existing frontend configuration | Passed                                                      |
| Production frontend build                                                                | Passed                                                      |
| Both production dependency audits                                                        | Zero vulnerabilities                                        |
| git diff --check                                                                         | Passed                                                      |

The new real-database suite verifies actual partial unique indexes and raw duplicate insertion rejection, 12 concurrent same-key writers, competing payloads, separate Node processes using one UUID, acknowledgement loss after persistence, normalization/defaults, owned replay after edits/deletion, tombstone exclusion from dashboard/budget totals, and template processing/history preservation. Existing authentication, CSRF, ownership, generation, monetary and group regressions remain passing. Existing validateSync deprecation warnings remain; unrelated audit findings were not addressed here.

Real Chromium used the actual Express API and a uniquely named disposable MongoDB database with a registered account. For each creation form, interception forwarded the first request to Express, observed HTTP 201 after persistence, then aborted the browser response. The transaction workflow closed/reopened the modal before retrying; the recurring workflow explicitly retried in place. Both sent the identical payload/UUID and CSRF header, displayed replay success and left exactly one visible resource (10001 paise transaction; 1201 paise future template).

Refresh retained the template and transaction. Intentional deletion through the existing UI followed by old-key retry returned 409 CREATION_DELETED for each. The dashboard and budget UI/API showed 10001 paise before deleting the manual transaction, and authoritative API totals returned to zero afterward, with no receipt resurrection. The local cookie remained HTTP-only/SameSite=Lax (Secure is disabled in this HTTP test environment); clearing it redirected a protected refresh to login. No production HTTPS deployment, full OS crash or Atlas failover is claimed.

A final real-browser regression also retained an uncertain transaction intent while its persisted record was deleted from another request. Identical retry displayed the specific deleted-receipt error without entering edit-version recovery. Explicit acknowledgement enabled a new intent; submitting it used a different UUID and produced exactly one live transaction alongside the original hidden receipt.

Both browser databases were dropped after verification. The final integration run dropped all ten disposable databases; a separate database inventory confirmed they were absent. Temporary Express/Vite servers and Chromium sessions were stopped. Ignored verification artifacts include `database-verification.json` and `final-browser-cleanup.json`.

Screenshots:

- `output/playwright/phase-5-step-2a/transaction-uncertain.png`
- `output/playwright/phase-5-step-2a/recurring-uncertain.png`
- `output/playwright/phase-5-step-2a/deleted-receipts-hidden.png`
- `output/playwright/phase-5-step-2a/deleted-intent-review.png`

### Changed files

Backend: transaction/recurring models, repositories, services and controllers; `src/utils/creation-intent.js`; existing API/repository test doubles and affected assertions; new `tests/creation-intent.test.js`, `tests/helpers/creation-api.js`, `integration/creation-intent.mongo.js`; existing recurring integration caller; test:mongo package script.

Frontend: transaction/recurring services and forms; `hooks/useCreationIntent.js`; `components/ui/CreationIntentNotice.jsx`; shared `utils/creationErrors.js` and transaction/recurring error mapping; ledger/recurring overlays and dashboard review-refresh wiring; affected service/page tests; `test/creationIntent.test.jsx`.

Documentation: README and this specification. The original audit is preserved. No dependencies, authentication contracts, group/settlement code, CI or environment secrets were changed.
