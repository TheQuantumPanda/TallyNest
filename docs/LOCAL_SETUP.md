# TallyNest Local Setup & Environment Guide

This guide walks you through setting up, configuring, running, and testing TallyNest on your local machine using either Bash/Zsh or Fish shell.

---

## Prerequisites

- **Linux x64** or **macOS**
- **Node.js 24 LTS** (managed via fnm or nvm: `.nvmrc` specifies `24`)
- **Docker** and **Docker Compose**
- **Git**
- Chromium browser (optional, for Playwright end-to-end tests)

---

## 1. Clone & Install Dependencies

From your terminal:

```bash
git clone https://github.com/TheQuantumPanda/TallyNest.git
cd TallyNest

# Install backend and frontend dependencies cleanly
npm run install:ci
```

---

## 2. Start Local MongoDB Instance

TallyNest uses MongoDB 8.0 with containerized health checks:

```bash
docker compose up -d --wait mongodb
```

Verify that the container is healthy:

```bash
docker compose ps
```

The database binds to `127.0.0.1:27017` on your local loopback. Data is preserved across restarts in the Docker volume.

---

## 3. Initialize Database Schema

TallyNest requires an explicitly provisioned database schema profile. It enforces strict JSON Schema collection validators and filtered unique indexes, refusing uninitialized databases at boot.

### Bash / Zsh

```bash
cd backend
npm run setup:env

# Generate a unique disposable test database name
FRESH_TEST_DB="$(node --input-type=module -e 'import { randomBytes } from "node:crypto"; console.log(`tallynest_fresh_v2_test_${Date.now()}_${randomBytes(6).toString("hex")}`)')"

# Install schema, collection validators, and indexes
npm run setup:cycles:fresh:test -- --database "$FRESH_TEST_DB"

# Export connection URI for this shell session
export MONGO_URI="mongodb://127.0.0.1:27017/$FRESH_TEST_DB"
cd ..
```

### Fish Shell

```fish
cd backend
npm run setup:env

# Generate a unique disposable test database name
set -gx FRESH_TEST_DB (node --input-type=module -e 'import { randomBytes } from "node:crypto"; console.log(`tallynest_fresh_v2_test_${Date.now()}_${randomBytes(6).toString("hex")}`)')

# Install schema, collection validators, and indexes
npm run setup:cycles:fresh:test -- --database $FRESH_TEST_DB

# Export connection URI for this shell session
set -gx MONGO_URI "mongodb://127.0.0.1:27017/$FRESH_TEST_DB"
cd ..
```

---

## 4. Run the Application

Start the backend in the same shell where you exported `MONGO_URI`; a new terminal does not inherit that export. Start the frontend in a second terminal from the repository root. On later sessions, export the exact retained database URI again. `setup:env` does not select the newly provisioned database for you.

### Terminal 1 — Express Backend API

```bash
npm run dev --prefix backend
```

The API starts on **http://localhost:5000** (or port `5500` in test configurations). It performs a read-only schema readiness check at boot and logs the verified database name.

### Terminal 2 — React / Vite Frontend

```bash
npm run dev --prefix frontend
```

The client starts on **http://localhost:5173**. Vite uses strict port 5173 so the browser origin continuously matches the backend's `CLIENT_ORIGIN` configuration.

Open **[http://localhost:5173](http://localhost:5173)** in your browser and register a local account.

---

## Environment Configuration Reference

### Backend (`backend/.env`)

| Variable              | Type         | Default                 | Description                                                                                                          |
| --------------------- | ------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `PORT`                | Number       | `5000`                  | HTTP port for the Express application.                                                                               |
| `NODE_ENV`            | String       | `development`           | Runtime environment (`development`, `test`, `production`).                                                           |
| `MONGO_URI`           | String       | _Required_              | MongoDB connection string. Must target an initialized database.                                                      |
| `JWT_SECRET`          | String (Hex) | _Required_              | Exactly 64 hex characters encoding 32 random bytes for signing JWTs.                                                 |
| `CLIENT_ORIGIN`       | URL          | `http://localhost:5173` | Allowed CORS origin. Strictly matched on all state-changing requests.                                                |
| `TRUST_PROXY_HOPS`    | Number       | `0`                     | Number of trusted upstream proxy hops. `0` locally; protected `2` is a hosted assumption pending chain verification. |
| `PROXY_SHARED_SECRET` | String       | _Optional_              | Shared secret between edge proxy and backend when `TRUST_PROXY_HOPS=2`.                                              |

### Frontend (`frontend/.env`)

| Variable       | Type | Default                     | Description                                    |
| -------------- | ---- | --------------------------- | ---------------------------------------------- |
| `VITE_API_URL` | URL  | `http://localhost:5000/api` | API base endpoint reached by browser requests. |

> [!WARNING]
> All `VITE_*` variables are statically bundled into browser JavaScript. Never put database credentials, JWT secrets, or cloud tokens into frontend environment files.

---

## Database Management & Clean Teardown

To shut down services cleanly and preserve or wipe local state:

```bash
# Stop backend and frontend with Ctrl+C in their respective terminals

# Stop MongoDB container while preserving volume data
docker compose down

# Destructive: removes ALL databases in this Compose volume.
# Use only when every database in the volume is disposable and approved for removal.
# docker compose down -v
```

The demonstration is not certified for real financial data. For financial-operation recovery, backup requirements and hosted limitations, see [Security & Verification](SECURITY_AND_VERIFICATION.md) and the [deployment/recovery rehearsal plan](deployment-rehearsal-plan.md). Never rename a real database to satisfy a disposable-name guard.
