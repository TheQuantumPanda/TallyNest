# TallyNest

Your money. In perspective.

Phase 1 provides the Node.js 24 / Express backend, JWT authentication, and a React 19
frontend with login, registration, and a protected personal workspace. Phase 2,
Steps 1–5 add the transaction model, exact monetary utilities, authenticated
personal transaction CRUD APIs, filtered cursor pagination, client version checks,
a responsive transaction management page, and a real financial dashboard.
Phase 3, Steps 1–5 add independent monthly expense-category budgets, exact
spending analytics, a responsive budget management frontend, and a recurring
personal transaction engine with a responsive management frontend. The overview and ledger
display only the signed-in user’s personal records; net
cash flow is not presented as a verified bank balance. Phase 4, Step 1 adds the
backend group/membership foundation with owner-controlled metadata management;
Step 2 adds secure invitations, joining, member listing, removal and leaving.
Step 3 adds separate shared expenses, exact splitting and permanent group history protection.
Step 4 adds exact group balances, deterministic debt suggestions and member-confirmed
settlements, with durable financial-write serialization and immutable settlement history.
Step 5 adds the responsive collaborative frontend for groups, invitations, shared
expenses, balances, settlement acknowledgement and explicit financial recovery.
Phase 5 Step 3B adds a dormant settlement-cycle model and optional compatibility
fields; the existing permanent settlement freeze remains in force. See
[the Step 3B specification](docs/phase-5-step-3b.md) for the activation boundary.
Step 3C adds an internal-only cycle-aware financial-write coordinator and
disposable-database concurrency tests. It does not enable multi-cycle activity
through the API; see [the Step 3C protocol](docs/phase-5-step-3c.md).
Step 3D adds internal owner-authorized cycle freeze, exact zero-balance closure,
next-cycle opening and durable recovery. These remain inactive for public APIs;
see [the Step 3D lifecycle specification](docs/phase-5-step-3d.md).
Step 3E adds a versioned offline migration **rehearsal only** for disposable local
databases, with encrypted backup/restore and exact reconciliation. See the
[Step 3E specification](docs/phase-5-step-3e.md) and
[cutover runbook](docs/runbooks/settlement-cycle-cutover.md); public cycle activity remains disabled.
Step 3F adds a disposable-test-only version-2 HTTP contract, and Step 3G adds a
matching test-only cycle frontend. Neither is active in the normal application;
see the [staged API](docs/phase-5-step-3f.md) and
[cycle frontend review guide](docs/phase-5-step-3g.md).
The local disposable Chromium gate is `npm run verify:browser`; see the
[Step 3H release-readiness report](docs/phase-5-step-3h.md). Public cycle
activation remains blocked pending a separately reviewed cutover.
The [Step 3I read-only preflight](docs/phase-5-step-3i.md) can inspect only a
uniquely named local disposable migrated rehearsal; correct strict validators
do not release its maintenance hold or authorize public activation.

## Run locally

Requirements: Node.js 24 LTS, npm, and Docker with Docker Compose.

From the repository root:

```bash
docker compose config
docker compose up -d --wait mongodb
cd backend
npm ci
npm run setup:env
npm run dev
```

In a second terminal, from the repository root:

```bash
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. The backend defaults to **http://localhost:5000**.
Vite uses strict port 5173 so the browser origin continues to match the backend's
`CLIENT_ORIGIN`. Use `localhost` consistently in the browser and API URL.

The frontend defaults to `http://localhost:5000/api` during development. To change
it, copy `frontend/.env.example` to `frontend/.env` only if a local file does not
already exist, then set `VITE_API_URL` and restart Vite. Only a public API URL belongs
in this file: all `VITE_*` values are bundled into browser code. Never put JWT
secrets, MongoDB credentials, or other server-only values there. The browser sets
the Origin header automatically; Axios sends cookies and `X-CSRF-Protection: 1`
for state-changing requests.

Edit `backend/.env` for local configuration. Existing shell environment variables
take precedence. The server validates configuration and connects to MongoDB before
listening. It also waits for user, budget, recurring schedule, transaction, group and
dormant settlement-cycle indexes to initialize,
and installs strict group membership collection validation. `.env` is
ignored by Git; never commit real credentials.

`npm run setup:env` creates `.env` from the example if absent. It preserves existing
nonempty settings, generates a signing secret only when missing or empty, adds the
default token lifetime if absent, and restricts file permissions to the owner.
The helper uses Node's `crypto.randomBytes(32)` and hex encoding, without printing
the secret. Use independently generated secrets in each environment. `JWT_SECRET`
must contain 64 hexadecimal characters with at least eight distinct digits; this
format check rejects obvious placeholders but cannot establish actual entropy.
`JWT_TTL_SECONDS` defaults to 900 and must be between 60 and 1800 seconds.

In another terminal:

```bash
curl -i http://localhost:5000/api/health
```

The endpoint returns HTTP 200 and:

```json
{ "status": "ok", "message": "Smart Finance Manager API is running" }
```

`npm start` runs the server without watch mode. SIGINT and SIGTERM close the HTTP
listener and MongoDB connection, with a 10-second shutdown deadline.

## Tests

From the repository root, with Node.js 24 and the local MongoDB service available:

```bash
docker compose up -d --wait mongodb
npm run verify:clean
```

`verify:clean` runs `npm ci` in both packages, then unit/HTTP tests, ESLint
for backend/frontend/shared JavaScript, Prettier checks for both packages,
shared code and current verification documentation, the frontend production
build, both production dependency audits, and the real MongoDB integration
suite. The latter uses uniquely named disposable databases and fails when
MongoDB is unavailable. The migration rehearsal suite also requires Docker access
to exactly one `mongo:8.0` container publishing port 27017 for its real encrypted
backup/restore drill. For an already installed checkout, use `npm run verify`;
`npm run verify:fast` runs all checks except MongoDB integration. The GitHub
Actions workflow runs the clean command on pushes to `main` and pull requests
targeting `main`. It does not run a browser suite.

See [Phase 5 Step 2B](docs/phase-5-step-2b.md) for CI design, full audit
results, manual browser verification and remaining release gates.

```bash
cd backend
npm test
npm run lint
npm audit --omit=dev
```

Frontend checks, from `frontend/`:

```bash
npm test
npm run lint
npm run format:check
npm run build
npm audit --omit=dev
```

ESLint 10 is configured independently for both packages. Backend linting adds no
runtime changes or changes to the authentication contract. Frontend tests use
Vitest, Testing Library, and isolated API mocks; they do not require MongoDB.
The root Prettier check reuses the frontend configuration for backend, shared
code and current verification documents. `npm run format --prefix frontend`
formats frontend files.

The built-in Node.js test runner exercises HTTP behavior, environment validation,
authentication, transaction/model constraints, exact money conversion, and
ownership-scoped repository queries using isolated in-memory repository doubles.
Tests do not connect to or modify the development database. `app.js` exports the Express app
and a `createApp` factory for injecting configuration; neither connects to MongoDB
or starts an HTTP listener on import. `server.js` owns environment loading and startup.
The server requires validated JWT configuration; an isolated app without a signing
secret keeps health checks usable but rejects login and registration with 503.

Routes call controllers; future business features follow
Controller → Service → Repository → Model. Empty layer directories are preserved
with `.gitkeep` until those features are implemented.

## Frontend screens and structure

| Route                  | Screen                                      | Access                  |
| ---------------------- | ------------------------------------------- | ----------------------- |
| `/login`               | Sign in                                     | Anonymous users         |
| `/register`            | Create account                              | Anonymous users         |
| `/app`                 | Financial overview                          | Authenticated users     |
| `/app/transactions`    | Personal transaction ledger                 | Authenticated users     |
| `/app/budgets`         | Monthly budget management                   | Authenticated users     |
| `/app/recurring`       | Recurring personal schedules                | Authenticated users     |
| `/app/groups`          | Collaborative groups                        | Authenticated users     |
| `/app/groups/:groupId` | Group workspace                             | Group members           |
| `/app/join/:token`     | Inspect and explicitly accept an invitation | Authentication required |
| `/app/account`         | Read-only account details                   | Authenticated users     |
| Other routes           | Not found                                   | Public                  |

`frontend/src` contains `components/` (including `ui/` and `auth/`), `pages/`,
`layouts/`, `context/`, `hooks/`, `services/`, `utils/`, `styles/`, and `test/`.
Axios configuration is centralized in `services/api.js`; `services/auth.js` matches
the backend's `data.user` response and selects only public profile fields.

The auth provider restores the session via `/api/auth/me` before rendering login
or protected content. Restoration failures distinguish anonymous 401 responses
from network failures, which offer retry. Protected API 401 responses clear the
in-memory session; login failures stay local to the form. Sessions are rechecked
when the authenticated window regains focus. Requests completing out of order
cannot overwrite a newer session state. No token or profile is persisted in
localStorage/sessionStorage, and there is no refresh-token flow. Failed logout
keeps the user signed in and provides a retryable error.

Forms have labels, associated validation messages, visible focus styles,
password visibility controls, and loading/disabled states. The mobile navigation
uses a native modal dialog for focus containment and Escape dismissal. Motion
and CSS respect reduced-motion preferences. Typography is self-hosted through
Fontsource; there are no third-party font requests. Tailwind v4 uses its Vite plugin.
Future finance modules appear only as clearly marked roadmap content.

## Frontend production configuration

`npm run build` creates `frontend/dist`; `npm run preview` serves it locally on port 5173. Set `VITE_API_URL` at build time for an API on another same-site HTTPS origin.
If omitted in production, the client uses `/api` on the frontend origin, which
requires the serving infrastructure to route `/api` to Express. Production hosting
must also serve `index.html` for React routes such as `/app/account` on hard reload.
Configure the backend's exact HTTPS `CLIENT_ORIGIN`; keep frontend and API same-site
for SameSite=Lax cookies. This task does not implement deployment or TLS termination.

## Authentication API

TallyNest is the product display name. The health-check response documented above,
JWT issuer/audience, cookie names, and MongoDB database name remain unchanged for
API and session compatibility. These internal identifiers are not display branding.

Success responses use `{ "status": "ok", "data": { "user": ... } }`, with a
message on registration and login. Logout returns `{ "status": "ok", "message":
"Logout successful" }`. Error responses use `{ "status": "error", "message": ... }`.
Public users contain only `id`, `name`, `email`, `createdAt`, and `updatedAt`.
Tokens and password hashes never appear in response JSON.

| Method | Endpoint             | Input / requirement           | Success                     | Expected errors                                                  |
| ------ | -------------------- | ----------------------------- | --------------------------- | ---------------------------------------------------------------- |
| POST   | `/api/auth/register` | JSON name, email, password    | 201, user and access cookie | 400 invalid input, 409 duplicate email, 429 rate limit           |
| POST   | `/api/auth/login`    | JSON email, password          | 200, user and access cookie | 400 invalid input, 401 invalid email or password, 429 rate limit |
| GET    | `/api/auth/me`       | Access cookie                 | 200, current user           | 401 missing/invalid/expired token or missing account             |
| POST   | `/api/auth/logout`   | CSRF headers; cookie optional | 200, cleared cookie         | 403 CSRF rejection                                               |

All POST authentication endpoints require `Origin: <CLIENT_ORIGIN>` and
`X-CSRF-Protection: 1`. Missing, null, or nonmatching origins are rejected with 403.
Registration and login require `Content-Type: application/json` (otherwise 415).
Only strictly defined fields are accepted. Names are trimmed (1–100 characters),
emails are trimmed and lowercased (maximum 254 characters), and registration
passwords require at least 12 characters and at most 72 UTF-8 bytes. Passwords are
not trimmed. The byte limit prevents bcrypt's silent input truncation.

## Security decisions and limits

- Password hashing and verification are centralized in the password service using
  bcryptjs with cost 12 and per-password salts. Unknown accounts still perform a
  bcrypt comparison and receive the same login error as incorrect passwords.
- Access tokens use HS256 exclusively, with issuer and audience verification,
  required expiration/issued-at/subject claims, and a maximum token age matching
  the configured lifetime. The JWT contains the user ID rather than profile data.
- Cookies are HTTP-only, host-only, SameSite=Lax, and use `Path=/` plus explicit
  expiration. Development uses `sfm_access`; production uses the Secure
  `__Host-sfm_access` cookie. Clearing uses the same cookie attributes. Authentication
  accepts cookies only; bearer headers and browser storage are not used.
- Production requires an HTTPS frontend origin and HTTPS browser access to the
  backend, normally through a TLS terminator. TLS/cloud deployment is outside this
  phase. Frontend and backend must be same-site. In development use `localhost`
  consistently on both sides rather than mixing it with `127.0.0.1`.
- CORS allows credentials only for the configured frontend origin. Browser clients
  must use `credentials: 'include'` and the CSRF header for POST, PATCH, and DELETE requests. Exact
  origin checks plus a required custom header provide CSRF protection in addition
  to SameSite, following the [OWASP API guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi).
  Trusted-origin script compromise remains outside this protection.
- Per-IP limits allow five registration attempts and ten login attempts per
  15-minute window, counting successes and invalid requests. Counters are in memory,
  independent per endpoint and process, and reset on restart. They are a basic local
  safeguard; multiple instances need a shared store. `trust proxy` remains disabled;
  a future reverse proxy must be configured explicitly before relying on client IPs.
- Logout clears the browser cookie but does **not** cryptographically revoke an
  already-issued JWT. A copied token remains valid until expiration, unless its
  account is removed or the signing secret is changed. No refresh tokens are issued.
- Duplicate registration returns 409, which reveals registration status by design;
  login responses do not distinguish unknown email from an incorrect password.
- Authentication responses are not cached. Internal auth errors and stack traces
  are hidden in every environment, and credentials/cookies/tokens are not logged.

## Manual authentication checks

Start the backend as above. From another Bash terminal, use a temporary cookie jar
with private permissions. These examples create a local account; change the example
email if already registered. The temporary jar contains an access token and should
never be committed or shared.

```bash
AUTH_COOKIE_JAR=$(mktemp)
chmod 600 "$AUTH_COOKIE_JAR"

curl --silent --show-error -c "$AUTH_COOKIE_JAR" \
  -H 'Origin: http://localhost:5173' -H 'X-CSRF-Protection: 1' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Local Test","email":"local-test@example.com","password":"correct horse battery"}' \
  http://localhost:5000/api/auth/register

curl --silent --show-error -b "$AUTH_COOKIE_JAR" -c "$AUTH_COOKIE_JAR" \
  -H 'Origin: http://localhost:5173' -H 'X-CSRF-Protection: 1' \
  -H 'Content-Type: application/json' \
  -d '{"email":"local-test@example.com","password":"correct horse battery"}' \
  http://localhost:5000/api/auth/login

curl --silent --show-error -b "$AUTH_COOKIE_JAR" http://localhost:5000/api/auth/me

curl --silent --show-error -b "$AUTH_COOKIE_JAR" -c "$AUTH_COOKIE_JAR" \
  -X POST -H 'Origin: http://localhost:5173' -H 'X-CSRF-Protection: 1' \
  http://localhost:5000/api/auth/logout

curl --silent --show-error -b "$AUTH_COOKIE_JAR" http://localhost:5000/api/auth/me
rm "$AUTH_COOKIE_JAR"
```

The sequence should return 201, 200, 200, 200, then 401. Repeat registration to
check 409; change the login password to check the generic 401; remove the CSRF
header to check 403. In the browser, inspect cookie attributes in
developer tools without copying or logging the token. JavaScript cannot read
the HTTP-only access cookie.

## Local MongoDB

Compose uses MongoDB 8.0, binds only `127.0.0.1:27017`, and persists data in the named
`mongodb_data` volume. This local development service has no authentication configured.
The health endpoint is a process liveness check; it does not recheck MongoDB on each request.

From the repository root:

```bash
docker compose stop mongodb
docker compose down
```

Stopping or removing the container preserves the named volume. `docker compose down -v`
also deletes local database data and should only be used when a reset is intended.

## Transaction foundation (Phase 2, Step 1)

The [transaction foundation specification](docs/phase-2-step-1.md) documents the
schema, categories, ownership, index plan, and original JSON contract. Step 2
implements the API described below; Step 4 provides its responsive frontend.

Amounts use `amountMinor`, a positive safe integer in paise, with `currency: "INR"`
(default). For example, ₹100.50 is `{ "amountMinor": 10050, "currency": "INR" }`.
Convert decimal text with the exact money utilities; never multiply a floating-point
rupee value or round overprecise input. Transaction dates use canonical UTC
`YYYY-MM-DDTHH:mm:ss.sssZ` timestamps; future monthly reporting must choose an
explicit reporting timezone. Ownership comes from the authenticated user, never
from the future request body. Repository reads always include that owner.

## Personal transaction API (Phase 2, Steps 2–3)

**Creation contract update (Phase 5 Step 2A):** POST /api/transactions and POST /api/recurring require a UUID `Idempotency-Key`. New creation returns 201 with `data.replayed: false`; identical replay returns 200 with `data.replayed: true` and the current resource. Deleted intents return 409 and cannot be resurrected. See [creation idempotency](docs/phase-5-step-2a.md) for exact contracts, receipts, rollout and uncertain-outcome guidance.

See the [CRUD specification](docs/phase-2-step-2.md) and current
[query/version specification](docs/phase-2-step-3.md) for endpoint examples,
validation, pagination, concurrency, and manual requests.

| Method | Endpoint                | Success                                                       |
| ------ | ----------------------- | ------------------------------------------------------------- |
| POST   | `/api/transactions`     | 201, created transaction                                      |
| GET    | `/api/transactions`     | 200, owned transactions with pagination (default 20, max 100) |
| GET    | `/api/transactions/:id` | 200, owned transaction                                        |
| PATCH  | `/api/transactions/:id` | 200, updated transaction                                      |
| DELETE | `/api/transactions/:id` | 200, `Transaction deleted`                                    |

All endpoints require the existing JWT cookie. POST, PATCH, and DELETE require
the configured Origin and `X-CSRF-Protection: 1`; POST/PATCH require JSON. Only
editable transaction fields are accepted. PATCH merges and fully validates the
result; `notes: null` clears notes. Owner and internal fields cannot be supplied.
Missing and foreign-owned IDs receive identical 404 responses. History is ordered
by date descending then ID descending by default; date and amount sorts support
both directions. Filters include type, category, currency, UTC date range, and
literal title search. `from` is inclusive and `to` exclusive.

Updates atomically compare and increment the stored version to prevent stale
writes. Transactions expose `version` and single-record responses include ETag.
PATCH requires `If-Match`: missing returns 428, stale returns 412, and races during
the atomic update return 409. CORS permits If-Match and exposes ETag. Transaction errors include stable `code`
values and never disclose internal details. Amounts remain positive safe integers
in paise with INR currency. Schema fields and the date index are preserved; an
owner/amount/ID index supports amount sorting.

Run the separate real-MongoDB integration suite against local Docker MongoDB:

```bash
docker compose up -d --wait mongodb
npm run test:mongo --prefix backend
```

It uses a uniquely named disposable database and removes it afterward. The default
backend test command still requires no database. Neither integration command loads
local `.env` secrets or writes to development user/transaction data.

Listing accepts `type`, `category`, `currency` (INR), `from`, `to`, `search` (literal,
case insensitive, max 80 characters), `sortBy` (`transactionDate`/`amountMinor`),
`sortOrder` (`asc`/`desc`), `limit` (1–100), and `cursor`. Unknown or invalid query
parameters return 400. For example:

```text
GET /api/transactions?type=expense&sortBy=amountMinor&sortOrder=desc&limit=10
```

The response retains `status: "ok"` and `data.transactions`, adding
`pagination: { limit, hasMore, nextCursor }`. Follow `nextCursor` with unchanged
filters/sorting; it is null on the final page. Cursors are encrypted/authenticated,
owner-bound, and expire after 24 hours. Insertions/deletions/updates between requests
can affect traversal because pages use current data rather than a snapshot. Title
substring search may scan many owned records; listings use a 1-second MongoDB
execution budget. See the query specification for precise limitations.

## Transaction management frontend (Phase 2, Step 4)

Choose **Transactions** in the authenticated desktop or mobile navigation, or open
`/app/transactions`. The page provides a desktop ledger and mobile cards, add/edit
forms, transaction details, confirmed deletion, server filters and sorting, and
cursor-based Load More. See the [frontend implementation and verification report](docs/phase-2-step-4.md)
for component architecture, screenshots, tests, and limitations.

Amounts are entered as decimal text and converted exactly with BigInt; 125050
paise displays as ₹1,250.50. Shared categories and monetary utilities keep frontend
and backend behavior aligned. Dates use UTC calendar days, with inclusive UI
filter dates mapped to the backend’s half-open range.

Edits fetch the current record and send its ETag through If-Match. Version conflicts
keep the draft visible and offer an explicit reload; changed drafts require discard
confirmation. The existing Axios client continues to send cookies/CSRF headers and
redirects expired sessions through the authentication context. No backend authentication
or transaction response contracts were changed.

Use the normal backend/frontend development commands above. Run frontend tests with
`npm test --prefix frontend`, build with `npm run build --prefix frontend`, and
verify MongoDB integration separately with `npm run test:mongo --prefix backend`.

## Real financial dashboard (Phase 2, Step 5)

The authenticated Overview at `/app` reports real income, expenses, net cash flow,
cash-flow charts, expense categories, and recent entries. It reuses Add Transaction
and links to the ledger. Reporting uses UTC calendar periods: This month, Last
month, Last 3 months (current plus previous two), and This year. Empty periods
show genuine zero values and useful guidance rather than invented analytics.

`GET /api/dashboard/summary?period=this_month&currency=INR` requires the existing
access cookie. The response is `{ status: "ok", data: { summary } }`. Owner-scoped
MongoDB aggregation converts safe integer paise through Int64 to Decimal128 before
summing; the service reconciles categories and time buckets with exact BigInt
arithmetic and rejects unsafe totals with 422. No currencies are combined.

See the [dashboard API and implementation report](docs/phase-2-step-5.md) for
response fields, period boundaries, percentage rounding, tests, screenshots, bundle
measurements, and limitations. Existing development commands remain unchanged.
Run `npm ci --prefix frontend` to install the new Recharts dependency if needed.
The chart module is lazy loaded; transaction and authentication contracts remain intact.

## Monthly budgeting backend (Phase 3, Step 1)

Budgets are independent personal records for a UTC calendar month (`YYYY-MM`),
expense category and INR currency. Limits use the existing positive safe integer
`amountMinor` paise representation. A unique owner/month/currency/category index
prevents duplicates, including concurrent creates. Budget writes never generate
or modify transactions. Step 2 provides the read-only spending summary below;
Step 3 integrates the monthly management frontend.

The authenticated API supports POST/GET `/api/budgets` and GET/PATCH/DELETE
`/api/budgets/:id`. Listing requires `month` (for example `?month=2026-10`), with
optional category and currency filters. Mutations use the existing Origin/CSRF
protection; PATCH requires the retrieved ETag in If-Match and atomic version checks.
Missing/foreign-owned records return identical 404 errors. See the
[budget schema, API and concurrency specification](docs/phase-3-step-1.md) for
request examples, validation rules, limitations and verification results.

Run the existing commands above: `npm test --prefix backend` for isolated tests,
then `docker compose up -d --wait mongodb` and `npm run test:mongo --prefix backend`
for disposable real MongoDB tests. No dependencies or environment settings change.

## Budget spending analytics (Phase 3, Step 2)

`GET /api/budgets/summary?month=2026-10` requires the existing authenticated cookie.
Month is mandatory and currency defaults to INR. The no-store response is
`{ status: "ok", data: { summary } }`, including every configured budget's exact
limit/spending/remaining/overspending, uncapped utilization basis points and status,
unbudgeted category expenses, reconciled monetary totals, and status/count summaries.
Income never reduces spending, and other owners/currencies/months are excluded.

Reporting uses half-open UTC calendar months. Owner-scoped MongoDB facets sum
integer paise through Int64 and Decimal128; BigInt calculations reject unsafe
results rather than round. Two concurrent database reads give an explicit
best-effort view, not a point-in-time budget/expense snapshot. Remaining allowance
is not a bank balance. Budget/transaction CRUD contracts and existing UI are intact.

See the [summary API and financial specification](docs/phase-3-step-2.md) for the
full response, status definitions, reconciliation rules, precision, consistency,
verification results and limitations. Existing test/development commands apply;
no dependencies or environment configuration were added.

## Budget management frontend (Phase 3, Step 3)

Choose **Budgets** in desktop/mobile navigation, or open `/app/budgets`. Select a
UTC reporting month, view real category limits/spending/status, create and edit
monthly budgets, or confirm deletion. Unbudgeted spending stays separate and
provides category-prefilled limit actions. The default month is the current UTC
month; historical and future records remain accessible through the month/year input.

Forms reuse shared expense categories, exact decimal-to-paise conversion, existing
UI/dialog infrastructure and the credentialed Axios client. Edits fetch current
records and send If-Match. Conflicts preserve drafts and require reload/review;
unsaved changes require discard confirmation. Deleting a budget never deletes an
expense. A failed unsafe summary can still expose validated saved limits for repair,
without fabricated spending. Remaining allowance is not a bank balance, and
utilization labels retain true values over 100% while bars cap visually.

See the [frontend implementation and verification report](docs/phase-3-step-3.md)
for architecture, API integration, tests, Chromium results, screenshots and known
limitations. Existing development/check commands above apply; no dependencies,
backend contracts, schemas or environment configuration changed.

## Recurring transaction backend (Phase 3, Step 4)

Recurring schedules describe expected income or expenses; they are not ledger entries.
Daily, weekly, monthly and yearly schedules generate ordinary personal transactions
using exact integer paise, existing categories and UTC dates. Monthly dates retain the
original intended day: January 31 → February 28/29 → March 31. Yearly February 29
uses February 28 in non-leap years and returns to February 29 in leap years.

The authenticated API supports POST/GET `/api/recurring`, GET/PATCH/DELETE
`/api/recurring/:id`, and POST `/:id/pause` / `/:id/resume`. Mutations require existing
Origin/CSRF protection. Updates and lifecycle changes require the current ETag through
If-Match. POST `/api/recurring/process` accepts `{ "limit": 20 }` (maximum 100) and
processes only the signed-in owner's due schedules with additional rate limiting.

After startup, the server runs a bounded batch immediately, then 60 seconds after
completion while awake. Persistent cursors catch up missed occurrences across repeated
batches; a sleeping host cannot execute at precise scheduled times. Pausing retains
the cursor; resuming catches up missed eligible dates. Edits affect uncompleted future
occurrences and never rewrite historical entries. Deleting a schedule preserves history.

A durable pending occurrence and unique schedule/date transaction index prevent
duplicate generation. Reserved work temporarily blocks schedule changes with 409.
Deleted generated entries retain hidden receipts, preventing resurrection on retry;
manual transaction deletion remains hard deletion. Ledger, dashboard and budget reads
exclude these receipts. Generated transaction responses add optional `recurrence`
provenance; existing fields and authentication contracts remain unchanged.

See the [recurring engine specification](docs/phase-3-step-4.md) for schemas, examples,
indexes, crash recovery, concurrency, scheduling limitations and verification results.
Existing local commands apply; no new dependencies, environment settings or frontend
screens were added. `npm run test:mongo --prefix backend` now also verifies recurring
behavior against disposable local MongoDB databases.

## Recurring management frontend (Phase 3, Step 5)

Choose **Recurring** in desktop/mobile navigation, or open `/app/recurring`.
Manage scheduled personal income and expenses with exact INR amounts, UTC start/end
inputs, all four recurrence frequencies, status filtering and server-paginated Load More.
Active/paused status stays distinct from exhausted schedules. Templates are expected
entries, not completed spending or bank payments.

Add/edit forms reuse shared categories and exact paise conversion. Edits and confirmed
pause/resume fetch fresh ETags, send If-Match and preserve drafts on conflicts. Unsaved
changes require discard confirmation. Paused schedules retain their cursor; resuming
may catch up missed eligible dates. Deletion preserves historical transactions.
**Check due entries** runs one bounded batch of 20, displays results and never loops
when more work remains. A sleeping host cannot execute precisely scheduled work.

The page links to the general transaction ledger because schedule-specific history
filtering is not supported yet. Existing generated provenance is retained by the
transaction API client. No backend contracts, schemas or scheduling rules changed.
See the [frontend implementation and verification report](docs/phase-3-step-5.md)
for the updated file tree, tests, Chromium results, screenshots and limitations.
Existing local development and verification commands above apply.

## Groups and membership backend (Phase 4, Step 1)

The authenticated API supports POST/GET `/api/groups` and GET/PATCH/DELETE
`/api/groups/:id`. Creating a group atomically creates its authenticated creator's
owner membership in the same document. Memberships are embedded, unique per group/user,
bounded to 100, and constrained by Mongoose and a strict MongoDB collection validator.
Currency is INR; no shared financial records or balance fields are introduced.

Reads/listings are member-scoped; metadata updates/deletion require database-enforced
owner permissions. PATCH requires the current ETag through If-Match, preserving the
428/412/409 concurrency conventions. Mutations require existing Origin/CSRF protection.
Missing and unrelated groups share identical 404 behavior. Listing uses bounded
`limit`/`after` pagination, default 20 and maximum 100. Responses expose only the
caller's membership role/time, not the complete roster.

Deleting an unmarked foundation group removes its embedded memberships only. Groups
with the Step 3 financial-history marker reject hard deletion and member departure.
Personal records remain unchanged. This policy must be revisited before shared expenses/settlements
exist. This section describes the Step 1 foundation; Step 2 adds invitations and
membership management below. Splitting and group UI remain unimplemented. See the [group and membership specification](docs/phase-4-step-1.md)
for schemas, indexes, permissions, API examples, atomic creation/failure semantics,
future decisions and verification results. Existing development/test commands apply;
startup requires MongoDB collection-validator/index administration permissions.

## Invitations and membership management (Phase 4, Step 2)

Owners can create/list/revoke invitations through `/api/groups/:id/invitations`.
Registered users inspect `/api/invitations/:token` and POST JSON `{}` to
`/api/invitations/:token/accept`. Tokens use 32 cryptographically random bytes;
only SHA-256 hashes are stored. The secret and manual-share paths are revealed once
on creation. Default expiry is 24 hours, maximum seven days; default uses is one,
maximum 20. Sensitive responses are no-store and token routes are strictly rate-limited.

Invitations are embedded and bounded to 50 per group. Acceptance atomically appends
both a normal member and a use receipt, preserving the creator-owner, the 100-member
limit and idempotent retry safety on standalone MongoDB. Expiry/revocation/remaining
uses are rechecked in the database write. Removed members cannot rejoin through the
same accepted link; a new invitation is needed. Expired/revoked metadata is reclaimed
on later invitation creation. Group deletion atomically invalidates all its links.

Members can GET `/api/groups/:id/members`, exposing ID, name, role and joining date,
with emails/private fields hidden. Owners DELETE `/api/groups/:id/members/:memberId`;
ordinary members POST `{}` to `/api/groups/:id/leave`. The sole owner cannot leave
or be removed. Invitation creation/revocation and removal/leave require the current
**group** ETag through If-Match, plus existing Origin/CSRF protection. Acceptance
requires authentication and CSRF, with an internal atomic version check.

No shared financial records, frontend pages, email delivery or personal-schema changes
are introduced. Deletion/removal rules must be revisited before shared expenses and
settlements. See the [invitation and membership specification](docs/phase-4-step-2.md)
for endpoint responses, privacy, token handling, concurrency/recovery, indexes, limits
and real MongoDB verification. Existing development/test commands apply; never log
invitation URL secrets or creation response bodies in future proxy/telemetry systems.

## Shared expenses and splitting (Phase 4, Step 3)

Members can POST/GET `/api/groups/:groupId/expenses` and GET/PATCH/DELETE
`/api/groups/:groupId/expenses/:expenseId`. Creator or group owner may edit/delete;
PATCH and DELETE require the current expense ETag via If-Match. POST requires a UUID
Idempotency-Key, preventing duplicate retries; deleting an expense retains a hidden
receipt so its original creation request cannot resurrect it.

Amounts/shares remain positive safe integer paise. Equal splits allocate indivisible
paise by stable user-ID order; exact splits must total the expense; percentage splits
use integer basis points totaling 10000 and BigInt largest-remainder allocation.
Selected participants may exclude other members, and every payer/participant must be
a registered current member. Listing uses bounded date/ID keyset pagination (20 default,
100 maximum). Groups and creators are immutable attribution fields.

**Current group deletion/departure policy:** before first expense persistence, the
backend atomically establishes a permanent financial-history marker. Group DELETE
and member removal/leave writes require its absence, preventing concurrent destructive
races. Marked groups cannot be deleted or lose members, even after all visible expenses
are deleted or an initial insert fails. Such conservative false-positive locks are
intentional until financial archival/departure policies exist. Unmarked groups retain
the earlier foundation policy; invitations may still add members to marked groups.

Group expenses stay separate from personal transactions, dashboard totals, budgets and
recurring records. There are no balances, settlements or frontend changes. See the
[shared expense specification](docs/phase-4-step-3.md) for schemas, algorithms, requests,
indexes, authorization, idempotency/recovery and real MongoDB concurrency results.
Existing development/check commands apply; no new dependencies or environment settings.

## Group balances and settlements (Phase 4, Step 4)

Backend-only; [full specification](docs/phase-4-step-4.md).

- `GET /api/groups/:id/balances` returns exact per-member paid, assigned, confirmed
  sent/received, signed net positions, pending reservations and deterministic suggestions.
- `POST/GET /api/groups/:id/settlements`, record GET, and recipient-only POST
  `/:settlementId/confirm` or `/reject` implement pending → confirmed/rejected.
- Creation requires a UUID `Idempotency-Key`; decisions require the record's
  `If-Match: "tn-<id>-v<version>"`. Cookie authentication, membership, configured
  Origin and mutation `X-CSRF-Protection: 1` are preserved.
- **The first valid proposal permanently freezes all expense create/edit/delete.**
  Existing deleted-expense receipts remain. Confirmed settlements have no correction
  or deletion endpoint. Recipient confirmation is acknowledgement, not bank proof.
- A non-expiring group reservation serializes all expense and settlement writes on
  standalone MongoDB. Unknown write failures require actor/owner POST
  `/api/groups/:id/financial-recovery` with `{}`; no forced unlock or silent retry.
- Net = paid − assigned + confirmed sent − confirmed received; all positions
  reconcile to zero using exact integer paise. Group records never affect personal
  transactions, budgets, dashboard or recurring records.

Run `npm test --prefix backend`, `npm run test:mongo --prefix backend` (local Docker
MongoDB required), and the existing frontend regression/lint/format commands above.
The MongoDB tests use disposable databases and verify cleanup.

## Collaborative finance frontend (Phase 4, Step 5)

Choose **Groups** in desktop or mobile navigation. Create a group, share an
owner-generated invitation, and manage shared expenses independently of personal
finances. Equal, exact and percentage previews reuse the backend pure split
algorithm; all amounts remain exact integer paise. Balances, pending reservations
and deterministic suggestions come from the server.

Financial history permanently blocks group deletion and member departure/removal.
The first valid settlement proposal permanently freezes expense modifications,
even if rejected. Confirmation records recipient acknowledgement, not payment
verification. There is no reversal or forced unlock. Interrupted operations offer
one explicit recovery attempt.

See [the frontend integration specification](docs/phase-4-step-5.md) for API bindings,
ETags, idempotency, invitation security, accessibility and limitations. Existing
local backend/frontend commands above apply; no new environment variables or
dependencies are required.

## Personal creation retry safety (Phase 5, Step 2A)

Transaction and recurring forms retain uncertain creation payloads and UUIDs in
account-scoped memory across modal and SPA route changes. Retry the identical
submission after an unknown outcome, or explicitly review current records before
starting a new intent. Full reload loses memory-only keys: inspect authoritative
records before creating again. New manual transaction and recurring schedule
deletions retain hidden creation receipts. Personal summaries exclude deleted
records; historical generated transactions remain after schedule deletion.

[Implementation and verification](docs/phase-5-step-2a.md) addresses audit H1
without changing the original audit findings. No new local configuration is needed.

### Staged cycle HTTP contracts (Phase 5, Step 3F)

The [staged HTTP specification](docs/phase-5-step-3f.md) documents the separate
version-2 cycle, shared expense, settlement, balance and recovery contracts.
These routes are constructed only by disposable authenticated integration fixtures;
ordinary application startup does not register or activate them. Legacy financial
locks and response envelopes remain unchanged. No migration hold is released.
