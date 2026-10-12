# Smart Finance Manager

Phase 1, Step 2 provides the Node.js 24 / Express backend foundation. Authentication,
finance features, and the React frontend are reserved for later tasks.

## Run locally

Requirements: Node.js 24 LTS, npm, and Docker with Docker Compose.

From the repository root:

```bash
docker compose config
docker compose up -d --wait mongodb
cd backend
npm ci
cp .env.example .env
npm run dev
```

Edit `backend/.env` for local configuration. Existing shell environment variables
take precedence. The server validates configuration and connects to MongoDB before
listening. `.env` is ignored by Git; never commit real credentials.

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

The built-in Node.js test runner exercises isolated HTTP behavior and environment
validation without a running MongoDB instance. `app.js` exports the Express app
and a `createApp` factory for injecting configuration; neither connects to MongoDB
or starts an HTTP listener on import. `server.js` owns environment loading and startup.

Routes call controllers; future business features follow
Controller → Service → Repository → Model. Empty layer directories are preserved
with `.gitkeep` until those features are implemented.

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
