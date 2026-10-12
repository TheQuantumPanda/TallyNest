# Smart Finance Manager

Phase 1 provides the Node.js 24 / Express backend foundation and JWT authentication.
Finance features and the React frontend are reserved for later tasks.

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
```

The built-in Node.js test runner exercises HTTP behavior, environment validation,
authentication, and model safeguards using isolated in-memory repository doubles.
Tests do not connect to or modify the development database. `app.js` exports the Express app
and a `createApp` factory for injecting configuration; neither connects to MongoDB
or starts an HTTP listener on import. `server.js` owns environment loading and startup.
The server requires validated JWT configuration; an isolated app without a signing
secret keeps health checks usable but rejects login and registration with 503.

Routes call controllers; future business features follow
Controller → Service → Repository → Model. Empty layer directories are preserved
with `.gitkeep` until those features are implemented.

## Authentication API

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
  must use `credentials: 'include'` and the CSRF header for POST requests. Exact
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
header to check 403. In a future browser client, inspect cookie attributes in
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
