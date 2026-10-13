# TallyNest

Your money. In perspective.

Phase 1 provides the Node.js 24 / Express backend, JWT authentication, and a React 19
frontend with login, registration, and a protected personal workspace. Phase 2,
Steps 1–4 add the transaction model, exact monetary utilities, authenticated
personal transaction CRUD APIs, filtered cursor pagination, client version checks,
and a responsive transaction management page. The welcome screen contains no
financial summaries; the ledger displays only the signed-in user’s actual records.

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
listening. It also waits for the unique user email index to initialize. `.env` is
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
{"status":"ok","message":"Smart Finance Manager API is running"}
```

`npm start` runs the server without nodemon. SIGINT and SIGTERM close the HTTP
listener and MongoDB connection, with a 10-second shutdown deadline.

## Tests

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
Prettier is configured for the frontend (`npm run format` formats its files).

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

| Route | Screen | Access |
| --- | --- | --- |
| `/login` | Sign in | Anonymous users |
| `/register` | Create account | Anonymous users |
| `/app` | Welcome / workspace overview | Authenticated users |
| `/app/account` | Read-only account details | Authenticated users |
| Other routes | Not found | Public |

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

`npm run build` creates `frontend/dist`; `npm run preview` serves it locally on port
5173. Set `VITE_API_URL` at build time for an API on another same-site HTTPS origin.
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

| Method | Endpoint | Input / requirement | Success | Expected errors |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | JSON name, email, password | 201, user and access cookie | 400 invalid input, 409 duplicate email, 429 rate limit |
| POST | `/api/auth/login` | JSON email, password | 200, user and access cookie | 400 invalid input, 401 invalid email or password, 429 rate limit |
| GET | `/api/auth/me` | Access cookie | 200, current user | 401 missing/invalid/expired token or missing account |
| POST | `/api/auth/logout` | CSRF headers; cookie optional | 200, cleared cookie | 403 CSRF rejection |

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

See the [CRUD specification](docs/phase-2-step-2.md) and current
[query/version specification](docs/phase-2-step-3.md) for endpoint examples,
validation, pagination, concurrency, and manual requests.

| Method | Endpoint | Success |
| --- | --- | --- |
| POST | `/api/transactions` | 201, created transaction |
| GET | `/api/transactions` | 200, owned transactions with pagination (default 20, max 100) |
| GET | `/api/transactions/:id` | 200, owned transaction |
| PATCH | `/api/transactions/:id` | 200, updated transaction |
| DELETE | `/api/transactions/:id` | 200, `Transaction deleted` |

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
