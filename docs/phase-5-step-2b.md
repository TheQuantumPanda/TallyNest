# Phase 5 Step 2B — Release verification and tooling

## Scope and outcome

The repository now has a root verification entry point and a GitHub Actions
workflow for the existing backend, frontend, shared financial code and real
MongoDB integration suite. Application behavior and financial API contracts
are unchanged. This step addresses audit items M9, M5 and L1; it does not
change the original audit's historical findings.

Added files: root `package.json`, `.github/workflows/verify.yml` and this
specification. Changed files: `backend/package.json`, `backend/package-lock.json`,
`backend/tests/transaction.test.js` and `README.md`. A further 108 existing
backend JavaScript files received Prettier-only normalization so the new
whole-backend formatting gate can pass. Shared and frontend source files were
checked and required no changes.

## Local verification

Use Node.js 24 and npm. The MongoDB integration tests connect only to a local
standalone server at `127.0.0.1:27017`; they generate unique disposable database
names and remove them in `after` hooks. They do not read `MONGO_URI` or `.env`.

```bash
docker compose up -d --wait mongodb
npm run verify:clean
```

`verify:clean` runs `npm ci` for backend and frontend, then `verify`.
`verify:fast` runs both unit/HTTP test suites, package ESLint, shared ESLint,
frontend Prettier, backend/shared/current-document Prettier, the production
frontend build and both production-only audits. `verify:mongo` runs the
unmocked MongoDB integration suite. `verify` runs both in sequence and exits
nonzero on any failure. A missing MongoDB server is a failure of the MongoDB
gate, not a skipped success. No root runtime dependency or monorepo framework
is introduced.

The formatting baseline covers all backend code (including tests and integration
scripts), the frontend package, every `shared/*.js` file, README and current
release-verification documentation. Backend files required a one-time Prettier
normalization to make a whole-tree formatting gate possible; those edits are
formatting only. The shared ESLint command uses the backend configuration and
explicitly includes the whole `shared/` directory. Thus financial algorithm
changes cannot bypass either check. Historical documentation remains available
without being rewritten to current style.

## CI workflow

`.github/workflows/verify.yml` runs on pull requests targeting `main` and pushes
to `main`. It uses maintained `actions/checkout@v7` and `actions/setup-node@v7`.
One Ubuntu job uses Node 24, cached npm downloads keyed by both lockfiles,
and a health-checked MongoDB 8.0 standalone service bound to localhost. It runs
`npm run verify:clean` once, so package installation is not repeated across jobs.
The integration scripts select random `tallynest_*_test_*` databases and assert
their removal. No production database URI, JWT signing secret or invitation token
is configured or printed. Unit tests supply isolated test configuration.

The workflow is syntax-checked locally, but only a GitHub run can prove the
hosted runner, Docker service and permissions work together. CI does not claim
browser coverage. The repository has no checked-in reusable Playwright suite.

## Development watcher and advisory

Before this change, the installed backend chain was nodemon 3.1.14 → chokidar
3.6.0 → braces 3.0.3. The full audit reported three High entries from one
development-only [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
and suggested an obsolete nodemon 1.14.10 downgrade. The production audit was
clean. `npm run dev --prefix backend` now uses [Node 24 watch mode](https://nodejs.org/download/release/v24.15.0/docs/api/cli.html#--watch)
to restart on imported source changes. Nodemon and its watcher dependency chain
were removed from `backend/package.json` and its lockfile. No other dependency
versions were intentionally upgraded. The development watcher was exercised
against a disposable local database and HTTP health check after a source file
timestamp change. The new full and production audit results are recorded below.

## Mongoose validation tests

`backend/tests/transaction.test.js` now awaits `document.validate()` and checks
the resulting `ValidationError.errors` paths for invalid records. This runs
asynchronous validation middleware, unlike deprecated `validateSync`. No
production schema or validation rule changed. The focused and full backend test
runs are checked for deprecation warnings below.

## Browser verification

There is no automated Chromium gate in CI. For a manual smoke check, start
Docker MongoDB, then use a **unique disposable database** via an explicit
process-only `MONGO_URI` override. Set a randomly generated test JWT secret and
the exact local `CLIENT_ORIGIN`; never edit the normal development `.env` or
database. For example, in a backend terminal from the repository root:

```bash
docker compose up -d --wait mongodb
export TALLYNEST_TEST_DB="tallynest_manual_test_$(node -e "console.log(Date.now().toString(16) + require('node:crypto').randomBytes(5).toString('hex'))")"
export TALLYNEST_TEST_JWT="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
NODE_ENV=test MONGO_URI="mongodb://127.0.0.1:27017/$TALLYNEST_TEST_DB" JWT_SECRET="$TALLYNEST_TEST_JWT" CLIENT_ORIGIN=http://localhost:5173 PORT=5000 npm start --prefix backend
```

Run `npm run dev --prefix frontend` in a second terminal. Register disposable
accounts, and exercise login, transaction creation, recurring schedules and
group flows. Inspect layouts at 1440, 1024, 390 and 320 pixels. Stop both
servers, check the name starts with `tallynest_manual_test_`, then remove only
that database with `mongosh "mongodb://127.0.0.1:27017/$TALLYNEST_TEST_DB"
--eval 'db.dropDatabase()'`. Do not run
manual browser checks against development financial data. The Step 2A report
contains the last executed Chromium financial flow; this tooling-only step does
not claim a new browser pass.

## Local results and remaining gates

The local Node.js version was 24.21.0. `npm run install:ci` completed for both
lockfiles; `npm run verify` passed all gates:

| Check                                                 | Executed result                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Backend unit/HTTP tests                               | 302 passed, zero failures/skips; no `validateSync` deprecation warning                 |
| Frontend tests                                        | 248 passed in 20 files                                                                 |
| Backend, frontend and explicit shared ESLint          | Passed                                                                                 |
| Frontend and backend/shared/current-document Prettier | Passed                                                                                 |
| Frontend production build                             | Passed                                                                                 |
| Backend and frontend production audits                | Zero vulnerabilities each                                                              |
| Real MongoDB integration                              | 155 passed, zero failures/skips                                                        |
| Disposable integration databases                      | All ten dropped; database inventory confirmed absence                                  |
| Backend and frontend full development audits          | Zero vulnerabilities each (backend before: three High entries from one dev-only chain) |
| Node watch restart smoke                              | Health 200 before and after restart; disposable database dropped                       |
| Workflow syntax                                       | PyYAML parsed trigger/service/command; actionlint v1.7.12 passed                       |
| `git diff --check`                                    | Passed                                                                                 |

The original audit finding remains historical evidence of the before state.
The installed backend after `npm ci` has no nodemon, chokidar or braces in its
dependency tree. No Mongoose major upgrade or financial calculation change was
needed.

The workflow has **not** been executed on GitHub. A checked-in workflow and local
syntax check cannot prove hosted-runner behavior. There is still no automated
browser gate. Production HTTPS, cloud database privileges, secrets, backups and
deployment verification remain separate release gates.
