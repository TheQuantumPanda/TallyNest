# TallyNest deployment rehearsal plan

Prepared 2026-10-20. Scope: isolated **generated accounts and financial records only**. No cloud resources, hosted databases, deployments, migrations, commits or pushes were created or performed during preparation. Provider documentation was reviewed; provider behavior has not been tested.

## Decision and scope

**GO for operator review and a separately authorized, isolated rehearsal. NO-GO for unattended hosted execution or public release.** Resolve the hosted prerequisites below before accepting any financial writes. A localhost pass does not prove production cookie delivery, proxy identity, Atlas permissions or recoverability.

Recommended conditional topology:

```text
Browser: https://<rehearsal-project>.vercel.app
  /assets/* and /app/* -> Vercel static React/Vite build
  /api/* -> Vercel HTTPS external rewrite (server-only ingress secret)
         -> https://<rehearsal-service>.onrender.com/api/*
         -> normal backend/server.js -> Atlas Free, approved fresh-v2 DB
```

Use one canonical browser origin, one backend instance and no custom domain requirement. Do not enable preview-origin wildcards or connect previews to the rehearsal database. Automatic deployments remain disabled until explicitly authorized. Vercel serves the normal React entry; Render runs the normal server, never the staged test composition.

This change adds a disabled-by-default protected ingress, operator-only provisioning and read-only backup audit tools, tests, and an example Vercel configuration. It does not change the financial write/recovery protocol, schema profile or UI.

## Routing, cookies and proxy trust

[vercel.json](../vercel.json) is the locally reviewed, uncommitted configuration targeting `https://tallynest-api-rehearsal.onrender.com`. [deployment/vercel.rehearsal.example.json](../deployment/vercel.rehearsal.example.json) remains an inactive reusable template; only the hostname differs. Neither file contains a secret value. Both platforms need the repository root because `shared/` is outside the backend/frontend directories. No deployment is authorized by this file's presence.

Routing order is deliberate: `/api` and `/api/*` go to Express first, including failures; existing build files are served next; other GET/HEAD paths fall back to `/index.html`. Thus `/app/groups/...` reloads reach React, while an unknown API path remains an Express JSON 404. Unsafe non-API requests do not receive the SPA fallback. Verify actual path captures, methods and query strings on Vercel before acceptance.

Vercel's route transform **sets/replaces** `x-tallynest-proxy-secret` from server-only `PROXY_SHARED_SECRET`. Render checks it before body parsing, authentication or business routes. Missing/wrong secret returns generic 403 with `Cache-Control: no-store`. Only exact GET/HEAD `/api/health` bypasses this gate; it exposes static health, not database/account state. Never forward this secret to a browser or return it in a response. A direct Render request with a forged Origin/X-Forwarded-For cannot substitute for the secret. The gate is an ingress control, not user authorization. [Vercel external rewrites and secret-header transforms](https://vercel.com/docs/routing/rewrites).

Forward browser `Origin`, cookies, content type, `X-CSRF-Protection`, `Idempotency-Key`, `If-Match`, `If-Group-Match`, `If-Cycle-Match` and query strings unchanged. Preserve backend `Set-Cookie`, ETag and `X-Group-ETag` responses. Do not rewrite Origin to the Render host or remove CSRF checks. CORS permits only the exact configured browser origin with credentials and exposes ETag headers. Mutations still require that exact Origin and `X-CSRF-Protection: 1`; a valid proxy secret does not bypass either check.

Production cookies are `__Host-sfm_access; Secure; HttpOnly; SameSite=Lax; Path=/`, with **no Domain**. If forwarded unchanged, a response received at the Vercel origin sets its host-only cookie there; the browser makes same-origin `/api` requests and needs no cross-site cookie policy. This is the intended contract, **pending HTTPS verification**. Leave `VITE_API_URL` unset: the production Axios default constructs the current browser origin plus `/api`. Do not set it to the Render URL or the literal relative string `/api` (current URL construction expects an absolute base).

The proposed protected path uses `TRUST_PROXY_HOPS=2`: socket peer Render ingress, rightmost forwarded hop Vercel, preceding address browser. Local tests prove this **assumed chain** and ignore additional untrusted left prefixes. Vercel documents its forwarding headers, but Render's actual chain still needs observation. Prove `req.ip` equals a known browser egress address, spoofed browser forwarding headers cannot change it, and distinct clients are distinguishable. Do this with temporary private instrumentation, then remove it; do not publish an IP diagnostic endpoint. If the chain differs, **stop**, do not switch to `trust proxy=true` or accept arbitrary forwarded addresses. [Vercel request headers](https://vercel.com/docs/headers/request-headers).

Private API routes already send `Cache-Control: no-store`. The example adds `private, no-store`, `CDN-Cache-Control: no-store`, `Vercel-CDN-Cache-Control: no-store` and `x-vercel-enable-rewrite-caching: 0` to the entire API route, including error responses. Do not enable rewrite cache rules, ISR, service-worker API caching or forced cache overrides. Inspect headers and cache behavior on success, denial, conflict and server-error responses; assert no private response becomes a CDN HIT. Vercel can cache external rewrites when configured/upstream headers allow it. [Vercel cache controls](https://vercel.com/docs/caching/cache-control-headers).

The protected Render ingress now also sets all three no-store cache headers before checking health/secret or parsing bodies. This covers unknown routes and parser failures at the origin as well as ingress denial. Existing route-level no-store headers and ETags remain intact. The Vercel rewrite-cache opt-out stays at the edge.

If secret transforms, cookie forwarding or verified proxy identity are unavailable on the selected free plan, this topology is blocked. The smallest alternative is a **single Render HTTPS origin serving the built Vite app and Express `/api`**, plus Atlas. That requires a separately reviewed static/SPA serving change and verified one-hop trust configuration; it is not implemented here. Do not compensate with wildcard CORS, cross-site cookies or relaxed authentication.

## Vercel configuration review — 2026-10-22

The latest official documentation supports the current static JSON approach:

- [`routes` transforms and environment expansion](https://vercel.com/docs/project-configuration/vercel-json#using-environment-variables-in-routes) document `request.headers`, `op`, `target`, `args` and a transform-local `env` allowlist. `$PROXY_SHARED_SECRET` is resolved from the project's environment at request time. If missing, the reference remains literal; Render rejects that literal because it cannot match a validated 64-hex secret.
- [Origin restriction](https://vercel.com/docs/routing/rewrites#restricting-your-origin-to-vercel-traffic) explicitly states that `set` replaces a visitor's existing header. This resolves the less precise wording in the generic transform table. No delete/append workaround is needed.
- [External rewrite caching](https://vercel.com/docs/routing/rewrites#disabling-caching-for-rewrites-to-external-origins) documents the `x-vercel-enable-rewrite-caching: 0` opt-out. Retain it alongside the no-store headers.
- [`vercel.ts`](https://vercel.com/docs/project-configuration/vercel-ts) provides build-time configuration, but is unnecessary here. Keep one root configuration; do not interpolate a secret with `process.env`, generate a secret-bearing JSON file or add a competing `vercel.ts`.

These configuration docs do not identify this protected rewrite pattern as paid-only. That supports retaining it for a Hobby rehearsal, **not a claim of verified account entitlement or edge execution**. [Hobby](https://vercel.com/docs/plans/hobby) is limited to personal, non-commercial use and quotas; confirm eligibility. If the actual project rejects transforms or environment expansion, stop and use the separately reviewed single-origin alternative above. Do not disable Render ingress protection.

Keep `PROXY_SHARED_SECRET` only in the intended Vercel deployment environment and Render runtime, with identical values and an independent JWT secret. Do not grant previews access to the rehearsal secret or database. Leave `VITE_API_URL` unset. Unprefixed environment variables are available to build processes, so treat build dependencies and configuration as trusted code; never expose secrets via `VITE_*`, Vite `define`, `envPrefix`, HTML, logs or response headers. `.env*` and `.vercel/` are ignored to prevent accidental inclusion of pulled environment files. Ignore rules do not replace review of staged files.

Local regression checks run with `npm test`: routing precedence/boundaries, all-method API routing, fixed origin, narrow secret transformation, cache directives, missing/literal/wrong/combined ingress values, health boundaries, CSRF/Origin, assumed IP buckets, production cookie attributes and ETags. They do **not** execute Vercel's edge. `npm run verify:deployment:bundle` builds with a random synthetic unprefixed secret and scans every generated public file for it and ingress markers; it prints no secret. This is included in `verify:fast`. It checks this build, not every possible future environment/configuration.

Exact next steps, after review and separate deployment authorization:

1. Review the uncommitted diff and include the root `vercel.json` with the tested changes. Keep both provider roots at the repository root, Node 24 and the existing build/start commands. Keep automatic deployments disabled until authorized.
2. Privately confirm the exact canonical Vercel origin, intended deployment environment, matching strong ingress secret and Render `CLIENT_ORIGIN`/protected two-hop setting. Do not print or paste secrets into repository files or command arguments. Do not change Atlas data or credentials as part of routing setup.
3. Deploy only under that later authorization. First use safe health and unauthenticated probes: through Vercel, `/api/auth/me` must return 401 both without a client secret header and with a deliberately wrong one; direct Render must return 403 for that path, including forged Origin/XFF. Health alone cannot prove secret resolution. Compare absent, lowercase/mixed-case and duplicate client ingress headers without ever sending the real secret from a browser.
4. Prove the actual IP chain before allowing financial writes. Then execute the hosted checklist below with separately approved generated records. Check query strings, all mutation methods, idempotency and conditional headers, host-only cookies, ETags, JSON API errors and no-cache behavior. Inspect repeated responses across accounts and denied/conflict/parser/server-error statuses; no private response may be a CDN HIT. Vercel-specific cache headers may be consumed by the platform, so inspect both effective cache behavior and browser-visible headers.
5. Verify browser assets, DevTools responses and private platform logs contain no ingress secret. Record sanitized evidence. Render sleep, finite proxy/client timeouts and ambiguous financial responses remain risks; retry the original intent/key and inspect authoritative state.

Do not use the existing disposable MongoDB/browser integration commands against Atlas. This routing review does not authorize database writes, deployment, commits, pushes or hosted settings changes.

Local review results (2026-10-22): `npm run verify:fast` passed: **329 backend tests**, **267 frontend tests**, backend/frontend/shared lint, formatting, production build and **33 public files** passing the synthetic-secret scan. Both production dependency audits reported **0 vulnerabilities**. Log: [deployment-routing-verify.log](../output/deployment-routing-verify.log). All properties used in both JSON configurations passed validation against the live official schema's relevant property definitions. Full remote schema meta-validation was not established: its draft-04 declaration includes unrelated newer-dialect constructs rejected by the available validator. No Vercel compiler or edge execution was run. No live MongoDB, hosted browser, deploy or hosted settings checks were performed; the tests use local isolated dependencies.

## Build, start and environment

| Location                             | Setting                                          | Placeholder/value                                                                                                                            |
| ------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Render                               | Root directory                                   | repository root                                                                                                                              |
| Render                               | Build command                                    | `npm ci --prefix backend --omit=dev`                                                                                                         |
| Render                               | Start command                                    | `npm start --prefix backend`                                                                                                                 |
| Render                               | Health path                                      | `/api/health`                                                                                                                                |
| Render                               | `NODE_VERSION`                                   | `24.21.0` (review/pin supported Node 24 patch before execution)                                                                              |
| Render                               | `NODE_ENV`                                       | `production`                                                                                                                                 |
| Render                               | `PORT`                                           | provider-assigned port (Render default `10000`); no hardcoded localhost binding                                                              |
| Render                               | `MONGO_URI`                                      | `mongodb+srv://<runtime-user>:<URL-encoded-password>@<cluster>.<id>.mongodb.net/tn_rehearsal_<12-lowercase-hex>?retryWrites=true&w=majority` |
| Render                               | `CLIENT_ORIGIN`                                  | `https://<rehearsal-project>.vercel.app` (exact origin, no path)                                                                             |
| Render                               | `JWT_SECRET`                                     | `<independent-cryptographically-random-32-bytes-as-64-hex>`                                                                                  |
| Render                               | `JWT_TTL_SECONDS`                                | `900` (supported 60–1800 seconds)                                                                                                            |
| Render + Vercel server configuration | `PROXY_SHARED_SECRET`                            | `<different-cryptographically-random-32-bytes-as-64-hex>`                                                                                    |
| Render                               | `TRUST_PROXY_HOPS`                               | `2`, only after the above chain is proven                                                                                                    |
| Vercel                               | Root directory                                   | repository root                                                                                                                              |
| Vercel                               | Install/build/output                             | `npm ci --prefix frontend --include=dev` / `npm run build --prefix frontend` / `frontend/dist`                                               |
| Vercel                               | Node version                                     | Node.js 24                                                                                                                                   |
| Vercel frontend                      | `VITE_API_URL`                                   | **unset**                                                                                                                                    |
| All                                  | Setup/backup/restore credentials, keys, receipts | **absent from service environments and repository**                                                                                          |

Runtime configuration rejects an HTTP production origin, weak signing/ingress secret format, equal signing/ingress secrets and unprotected/blanket proxy trust. Generate secrets privately; placeholders are not valid configuration. Vite embeds `VITE_*` values into the public bundle: no database URI, passwords, signing/ingress secret or backup key may use that prefix. Vercel's server-only ingress environment is distinct from frontend build configuration.

`server.js` uses Node's normal all-interface PORT listener. It connects with Mongoose automatic collection/index creation disabled, performs complete **read-only** fresh-v2 readiness, and listens only after success. It does not run either installer or a migration. Readiness rejects missing/drifted validators/indexes, wrong manifests, legacy financial associations and incompatible databases. Per-request readiness is narrower; it is not a continuous full-schema scanner. Privileged DDL requires stopped writers and restart/readiness validation. [Render port binding](https://render.com/docs/web-services), [Render Node versions](https://render.com/docs/node-version).

SIGTERM/SIGINT stop accepting HTTP work, drain requests and recurring work, close MongoDB, and enforce a 10-second shutdown deadline. A hard kill may interrupt work; persistent fixed-intent receipts and reservations remain authoritative. Only the original authorized recovery path may finish them. Never clear a reservation by elapsed time or edit a financial document to unlock it.

Login and registration have separate process-local IP limits (10 and 5 per 15 minutes); financial limits use authenticated user identity (300 per 15 minutes). Limits reset on restart and are not shared between instances. The ingress secret protects the assumed IP path; CORS is not an IP trust boundary. Keep a single instance and verify actual hosted IP and per-user isolation. This is not a distributed abuse-control guarantee.

Application logs must contain only generic failures and aggregate job counters, never raw driver errors, URI credentials, JWT/cookie/CSRF values, request bodies or financial payloads. Check actual Vercel/Render access and build logs too, including invitation-token URLs; application redaction cannot prove platform log behavior. Restrict log access/retention and redact/suppress sensitive paths where supported. If a required platform cannot prevent exposed tokens, do not accept the rehearsal as secure.

## Atlas privileges and supported commands

Use a dedicated Atlas project/cluster and short database `tn_rehearsal_<12hex>` (25 bytes). Record Atlas organization/project/cluster IDs, SRV hostname, `hello.setName`, database and chosen region in the private approval record. Check them independently in Atlas before executing. Restrict network access to operator and Render egress ranges; do not silently enable `0.0.0.0/0`. Vercel does not connect to MongoDB.

Atlas Free supports custom roles with a subset of actions; create users/roles through Atlas controls, not database `createUser`/`createRole` commands. Role changes may take time to propagate. Actual `createCollection` with this manifest's validators, `createIndex`, full `listCollections` metadata including UUID, `listIndexes`, aggregation and `hello` must succeed with the intended roles before opening the app. These command/grant combinations are **not yet proven on Atlas**. No installer uses `collMod` to repair schema. [Atlas custom roles](https://www.mongodb.com/docs/atlas/security-add-mongodb-roles/), [database users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/), [unsupported commands](https://www.mongodb.com/docs/atlas/unsupported-commands/).

| Identity     | Required scope and actions                                                                                                                                 | Exclusions/lifecycle                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup        | Exact approved DB: `listCollections`; approved ten namespaces: `find`, `listIndexes`, `createCollection`, `createIndex`; manifest only: `insert`, `update` | No drop/reset, `collMod`, validator bypass, user/role administration or unrelated DB access. Keep offline; revoke after readiness.                            |
| Runtime      | Exact DB `listCollections`; ten approved namespaces `find`, `listIndexes`; nine application namespaces `insert`, `update`, `remove`                        | Manifest read-only. No explicit DDL, `createIndex`, `collMod`, drop, bypass, migration collection or role admin. No `readWrite`, `dbOwner` or admin fallback. |
| Backup/audit | Exact source DB metadata plus named namespace `find`/`listIndexes`                                                                                         | Read-only; no setup, runtime mutation or restore permissions.                                                                                                 |
| Restore      | A different explicitly approved **empty** target, approved namespace create/insert/index actions and read-only audit metadata                              | Never source DB write access; revoke before app startup. Verify exact Database Tools requirements on the chosen Atlas tier.                                   |

Namespace names are `freshschemamanifests`, `users`, `transactions`, `budgets`, `recurringschedules`, `groups`, `groupexpenses`, `groupsettlements`, `groupfinancialcycles`, `groupcycletransitions`. The existing readiness checks also require **read-only `find` on `cyclemigrationruns`**, even when that collection is absent. Grant that guard read to setup, runtime and backup/audit identities; never create it or grant writes. No wildcard collection grants are needed for CRUD.

Important least-privilege limit: MongoDB's `insert` action itself permits creation of its named collection. Thus scoped runtime CRUD prevents arbitrary namespaces and explicit schema alteration, but **cannot guarantee that a dropped application collection can never be recreated**. Keep privileged schema operations offline, withhold runtime credentials until setup is ready, and require startup readiness after maintenance. Test negative permissions in a separate generated canary DB, never by dropping a live financial collection. [MongoDB privilege actions](https://www.mongodb.com/docs/manual/reference/privilege-actions/).

## Operator-controlled fresh provisioning

The existing `setup:cycles:fresh:test` remains local/disposable only. The separate `setup:cycles:fresh:approved` CLI accepts only generated rehearsal databases; it is not a production migration utility. It is never called by a route, startup or background job.

1. Obtain separate authorization for the named Atlas resources, roles and **one exact empty DB**. Confirm no prior users, application writers or scheduled jobs target it. Keep runtime credentials withheld. Inspect the private target identity above and collection inventory using setup credentials.
2. On an operator-controlled machine, create a directory **outside the repository**, mode `0700`; files must be regular, non-symlink, mode `0600`. Do not paste URI passwords into shell arguments, history or ordinary logs. Privately create a JSON credentials file with only `{"uri":"<setup-SRV-URI-with-exact-database>"}`.
3. From the repository root, print the approved schema fingerprint **offline**:

   ```bash
   npm run setup:cycles:fresh:approved --prefix backend -- --schema
   ```

   Review the current `fresh-cycle-schema.js` manifest/validators/indexes and fingerprint with the exact code revision. Create a private plan (replace placeholders; example is intentionally non-executable):

   ```json
   {
     "formatVersion": 1,
     "setupId": "<new-UUID>",
     "purpose": "generated-data-only",
     "target": {
       "srvHost": "<cluster>.<id>.mongodb.net",
       "database": "tn_rehearsal_<12-lowercase-hex>",
       "replicaSet": "atlas-<approved-replica-set>"
     },
     "schemaDigest": "<reviewed-schema-fingerprint>",
     "writersStopped": true,
     "runtimeCredentialWithheld": true
   }
   ```

4. Review **without connecting**, then have the operator explicitly approve the displayed digest, which binds the complete plan, fresh schema, unique setup ID and target:

   ```bash
   npm run setup:cycles:fresh:approved --prefix backend -- \
     --plan /outside/private/setup-plan.json --review
   ```

5. Only following that separate approval, execute (not executed in this task):

   ```bash
   npm run setup:cycles:fresh:approved --prefix backend -- \
     --plan /outside/private/setup-plan.json \
     --credentials /outside/private/setup-credentials.json \
     --receipt /outside/private/setup-receipt.json \
     --approve '<exact-reviewed-approval-digest>'
   ```

The tool checks approval **before credentials/connect**, SRV/TLS options, exact host/database and connected replica-set identity. It rejects unknown collections (including migration markers), any application records, unowned existing schemas, incompatible partial validators/indexes, and legacy data. It installs only the existing approved manifest/profile and validators/indexes; no drop, reset, overwrite, repair or migration path exists.

The external durable receipt binds plan/setup ID and the created manifest collection UUID. An exclusive local lock prevents concurrent use of that receipt. After a known interruption, use the **same plan, receipt, target and approval**; only the installer's valid checkpoint state is resumable. Never issue a new receipt to adopt an existing database. A crash between collection creation and persisting its UUID is intentionally ambiguous and refuses automatic resume: retain/quarantine that target and seek approval for a different empty DB. A stale lock also requires operator investigation, not automatic timeout removal. Duplicate operators must be excluded operationally; the local lock is not a distributed lease.

After success, retain the private receipt and approval independently, verify read-only readiness and actual runtime negative grants, revoke setup access, and only then supply runtime credentials and authorize service startup. A completed database containing any application data is rejected by setup, even if its schema is valid. Keep valid interrupted financial operations reserved; provisioning is never their recovery path.

## Backup and isolated restore

No Atlas automatic backup is assumed or enabled. Current tier-specific documentation describes an **optional paid/private-preview Free-cluster backup**; that is excluded from this free rehearsal. Manual Database Tools plus local encryption and independently retained storage are the planned no-paid-service route. Check installed tool compatibility with Atlas MongoDB 8.0 before use. [Atlas Free backup offering](https://www.mongodb.com/docs/atlas/backup/cloud-backup/free-cluster-backup/), [Atlas backup/restore options](https://www.mongodb.com/docs/atlas/backup-restore-cluster/).

1. Stop **all** writers, including Render recurring processing and any authenticated manual processing. Prevent restart/wake with usable writer credentials. Wait for in-flight jobs and role revocation to take effect. Resolve pending/applying financial work through its original authorized fixed-intent recovery **before** declaring a reconciled backup. Never delete locks, reset keys or assume MongoDB dump is an application-wide transaction snapshot.
2. With read-only backup credentials in a private file, run `backup:fresh:audit` before dumping. Its explicit plan/approval has the same target format as provisioning; it does **not** grant permission to provision that source. Use a fresh private output filename:

   ```bash
   npm run backup:fresh:audit --prefix backend -- \
     --plan /outside/private/source-plan.json \
     --credentials /outside/private/backup-credentials.json \
     --output /outside/private/source-before.json \
     --approve '<exact-reviewed-source-plan-digest>'
   ```

   The auditor is read-only: complete schema readiness, raw record validators, financial model validation, cycle associations, member identities, exact BigInt per-cycle balances and zero-balance closed cycles. It refuses unresolved group/recurring operations and changing data/schema. Its private proof includes document counts, all-record canonical hashes (including receipts and tombstones), index/validator hashes and cycle financial hashes. These are reconciliation evidence, not proof that historical business intent was correct.

3. With `umask 077`, shell `pipefail` and no-clobber enabled, stream a database-only compressed dump into `age` public-key encryption. Illustrative commands require operator review and installed tools; **none were run against Atlas**:

   ```bash
   set -o pipefail
   set -o noclobber
   umask 077
   mongodump --config=/outside/private/source-tools.yml \
     --db='tn_rehearsal_<source-12hex>' --archive --gzip --quiet \
     2>/outside/private/dump-errors.txt | \
     age -r '<public-age-recipient>' > /outside/private/backup.archive.gz.age
   ```

   Substitute real identifiers before use; angle-bracket placeholders are not shell-ready. The mode-0600 YAML config contains `uri: "<read-only-SRV-URI>"`, with credentials kept out of argv/environment. Treat tool stderr as private because driver diagnostics may expose connection details. Check **every** pipeline exit code; quarantine incomplete ciphertext. Run the audit again with a new output path; require all before/after hashes and counts equal. [mongodump private config and archive options](https://www.mongodb.com/docs/database-tools/mongodump/), [age usage](https://github.com/FiloSottile/age).

4. Record ciphertext SHA-256, tool versions, application revision/schema fingerprint, source identity, capture time and private proofs. Encrypt proofs too. Copy ciphertext and encrypted evidence to an independently controlled offline disk/location, verify copied hashes, and test retrieval. Keep the private encryption key separately recoverable, with independently checked offline copies; never with the only archive, on Render's ephemeral disk or in Git. A public recipient is sufficient to create backups; only recovery operators need the private key.
5. Separately approve a different empty isolated restore target, with no runtime writer credentials. Verify exact host/replica set/database and **zero collections** independently. Do **not** preinstall the fresh manifest before restoring it. Fully authenticate/decrypt the archive successfully into a fresh, nonexistent file in private RAM-backed or encrypted scratch storage before restoring; do not pipe an incompletely authenticated plaintext stream into a database.

   ```bash
   age --decrypt -i /separate/private/recovery-key.txt \
     -o /outside/private/scratch.archive.gz /outside/private/backup.archive.gz.age
   mongorestore --config=/outside/private/restore-tools.yml \
     --archive=/outside/private/scratch.archive.gz --gzip \
     --nsInclude='tn_rehearsal_<source-12hex>.*' \
     --nsFrom='tn_rehearsal_<source-12hex>.*' \
     --nsTo='tn_rehearsal_<restore-12hex>.*' \
     --stopOnError --maintainInsertionOrder --numInsertionWorkersPerCollection=1 \
     >/outside/private/restore-report.txt 2>&1
   ```

   Restore config credentials must be scoped only to the approved destination; confirm namespace remapping in a disposable rehearsal. Keep diagnostic output private. Never use `--drop`, user/role restore, `admin` dumps, `--preserveUUID` or `--oplogReplay`. Free-tier restrictions prevent treating this as oplog/PITR recovery. On error, quarantine the partial destination; do not reset/reuse it automatically. [mongorestore archive/namespace options](https://www.mongodb.com/docs/database-tools/mongorestore/), [Atlas command restrictions](https://www.mongodb.com/docs/atlas/unsupported-commands/).

6. Run `backup:fresh:audit` with the restore target's separate plan/read-only credentials. Require exact source/restore record counts, data, schema and financial hashes; verify normal startup, authenticated reads, multi-cycle history and authorized retries in the isolated restored environment. Restore users, receipts, tombstones and transitions intact; do not merge with another financial DB. Revoke restore credentials, remove private plaintext scratch using storage-appropriate disposal, and retain only protected evidence. No restored environment may send notifications or process writes until separately authorized.

RPO is the last successfully captured, independently retained and verified manual backup. RTO is unmeasured until the hosted restore drill. No point-in-time recovery, guaranteed daily schedule, cross-region durability guarantee or zero-data-loss claim is made. A workstation being off, expired credentials, quota exhaustion or a missed manual backup increases loss exposure. The older migration backup/reconciliation tooling assumes a single legacy cycle; its local encrypted drill is **not** hosted fresh-v2 restore evidence.

## Free-tier operating limits

- Render Free sleeps after 15 minutes without inbound traffic; wake commonly takes about a minute, and its disk is ephemeral. The workspace has 750 free instance hours per month; exhaustion and other quota limits can suspend service. The app's recurring worker runs a bounded batch on startup and every 60 seconds **while running**, not while asleep. Catch-up is bounded; sleep is not reliable financial scheduling. No keep-alive service or paid cron is introduced. The browser's 10-second Axios timeout may expire during wake: inspect authoritative state and retry the same intent/key, never create a replacement payment blindly. [Render Free limitations](https://render.com/docs/free).
- Atlas Free currently has 0.5 GB including indexes, 500 connections and 100 operations/second, with throttling and idle-pause constraints. Names are limited to 38 bytes for databases and 95 bytes for namespaces. Keep generated data small, monitor quotas and use short names. The local integration FD guard uses `serverStatus` details not available on Free; never point that harness at Atlas. [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).
- Vercel's external proxy has a finite timeout; it does not remove cold-start uncertainty or make failed network responses proof of failed financial writes. Confirm Hobby eligibility, route transforms, env handling and current quota/billing settings with the operator. No paid feature or upgrade is authorized. [Vercel limits](https://vercel.com/docs/limits).
- JWT sessions have a bounded lifetime and no refresh-token flow; a 15-minute sleep may outlast a 900-second session. Logout clears the browser cookie; a previously stolen JWT is not server-revoked before expiry unless account/signing state changes. Do not claim stronger session guarantees.

## Hosted acceptance checklist — all NOT RUN

Run only after separate approval, against generated accounts/records. Retain private timestamped evidence, exact app revision, sanitized request/response headers, API balance assertions and browser screenshots. Never publish cookies, invite tokens, account payloads or private proofs.

- [ ] Approve resources, exact origin, Atlas identity/region, network allowlist, free-tier spending safeguards and separate identities. Disable preview access to this DB and unattended deployment.
- [ ] Prove the secret is injected/replaced server-side and absent from browser assets/DevTools responses. Direct Render account/API requests without it fail, while safe health probes succeed. Spoofed forwarding headers cannot bypass the gate.
- [ ] Observe actual trusted proxy chain and known egress IP from two clients; try spoofed XFF/real-IP headers. Verify auth IP buckets and authenticated per-user buckets across accounts; record restart/reset limitation.
- [ ] Register three independent generated accounts, login, restore sessions on reload, logout and verify cookies over HTTPS: Secure, HttpOnly, Lax, Path=/, host-only/no Domain, inaccessible to JavaScript. Confirm no Render cookie dependency.
- [ ] Exact good Origin works; wrong, missing and `null` Origin on mutations and missing/wrong CSRF fail. CORS denies other origins and preview domains. Preflights preserve required allowed/exposed headers.
- [ ] Vercel `/app/*` deep links survive direct navigation/reload; API unknown routes/errors remain JSON. Requests use same-origin `/api`, normal v2 workspace is present, and public assets contain no secrets or disposable test entry.
- [ ] Repeat the existing normal-server three-account financial journey: explicit first cycle, boundary invitation acceptance, equal/exact/percentage expenses, edit/delete, settlement reject/confirm, pending restrictions, freeze/zero-balance close/next cycle, immutable history, later-member historical denial, cross-account denial, stale ETags and personal/group navigation. Assert exact integer balances through the authoritative API at each stage, not screenshots alone. Use the scenarios in [`frontend/e2e/normal-cycle.e2e.js`](../frontend/e2e/normal-cycle.e2e.js) as the executable local reference.
- [ ] Drop a financial response and retry its original key/payload; prove one effect. Interrupt applying work/process, restart, verify reservation persists and unrelated mutations remain blocked, then perform original authorized fixed-intent recovery. Unauthorized actor fails. No timeout unlock or manual financial edit.
- [ ] With the actual Atlas runtime role, startup and ordinary workflows succeed; explicit index/validator/drop/unrelated-namespace operations are denied in an approved generated canary. Confirm manifest read-only and setup credentials absent from runtime. A permission failure blocks acceptance; do not grant broad admin roles.
- [ ] In a separate approved generated schema-drift canary, prove wrong validators/indexes/profile cause startup rejection before listen and are not auto-repaired. Never mutate the rehearsal financial source to test drift.
- [ ] Capture an encrypted manual backup, retain it independently, retrieve the separately recoverable key and restore into another empty isolated target. Compare complete schema/data/financial proofs and normal multi-cycle behavior. Record measured RPO/RTO and all denied unsupported commands.
- [ ] Let Render sleep naturally; test wake, expired session, client timeout and bounded recurring catch-up. Verify no duplicate generated records, no phantom successful financial writes and no promise of background execution during sleep.
- [ ] For multiple accounts and paths/statuses, confirm no-store headers and no CDN cache HIT/shared private body, including ETag/conflict/authorization/error responses and Set-Cookie forwarding. Avoid recording credentials in evidence.
- [ ] Inspect application, platform access/build and error logs after success, failure and recovery. No JWTs, cookies, passwords, invitation tokens, connection strings or financial bodies. Confirm quotas/allowlists do not require unapproved exposure or payment.

## Local verification evidence

Results are recorded below after the required local runs. These prove local behavior only; every hosted checkbox above remains unexecuted.

| Check                                    | Result                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run verify:clean`                   | **PASS**: clean backend/frontend installs, 321 backend tests, 267 frontend tests (23 files), lint, formatting, production build, production audits and 274 MongoDB tests across 18 serial files; zero failures/skips.                                        |
| Focused setup/backup rerun               | **PASS**, 4 tests after adding the generated-target collision guard; all 14 owned DBs removed; FD headroom returned to 10 open files.                                                                                                                        |
| `npm run verify:browser`                 | **PASS**, 5 Chromium tests: 3 existing disposable/staged UI regressions plus 2 **normal server/normal React entry** tests. Normal multi-user workflow checks exact API balances, authorization, retries and recovery. Both browser DB cleanup checks passed. |
| `npm run lint` / `npm run format:check`  | **PASS**, including new backend tools/tests, plan and inactive routing example.                                                                                                                                                                              |
| `npm run build` (standalone repeat)      | **PASS**. Normal `CycleWorkspace` production chunk present; 23 public JS files checked, no backend secret-variable names or known disposable-entry markers found. This does not prove future hosted environment configuration.                               |
| `npm run audit:prod` (standalone repeat) | **PASS**, backend and frontend each report zero vulnerabilities.                                                                                                                                                                                             |
| Vercel example static validation         | **PASS** against the relevant published JSON-schema properties used by this file. No Vercel build/deploy or hosted routing validation executed.                                                                                                              |
| `git diff --check`                       | **PASS**. Changes remain uncommitted.                                                                                                                                                                                                                        |

New coverage proves exact-plan approval before database access, URI identity/TLS restrictions, offline CLI review and approval refusal, ingress bypass denial, unchanged Origin/CSRF checks, bounded proxy IP buckets, ownership-bound checkpoint resume, ambiguous-ownership refusal, and unchanged rejection of legacy/unknown/data-bearing/drifted targets. The authenticated MongoDB test now uses named-collection setup/runtime roles, with manifest-write, unrelated-write, index, validator and drop denials, while preserving original authorized financial recovery.

The fresh backup test creates two cycles using production services, including a confirmed settlement and expense tombstone; closed-cycle balances reconcile to zero and active balances retain exact minor units. An isolated **native collection copy** produces identical full-data/schema/financial proofs; corrupting only that generated copy's closed-cycle expense makes reconciliation fail. This is not an encrypted fresh-v2 Database Tools roundtrip or Atlas restore claim. Hosted SRV transport, role creation/propagation and the operator CLI's complete Atlas execution remain untested.

The recorded offline schema fingerprint is `35f23db2e3138a6c2d352d180fcac13fcfbfdcd126f1976d37141f41589ec9d7`. Recompute and review it for the actual approved revision. The full provider JSON schema has mixed-draft constructs incompatible with the existing Ajv 6 validator; validation was limited to all properties used by the example. It is not a substitute for provider acceptance.

Local evidence logs: [clean verification](../output/rehearsal-prep-verify-clean.log), [focused MongoDB](../output/rehearsal-prep-targeted-mongo.log), [Chromium](../output/rehearsal-prep-browser.log), [lint](../output/rehearsal-prep-lint.log), [formatting](../output/rehearsal-prep-format.log), [build](../output/rehearsal-prep-build.log), [audits](../output/rehearsal-prep-audits.log), [routing-schema properties](../output/rehearsal-prep-vercel-schema.log). These generated logs/artifacts are local and ignored by Git.

Browser captures were regenerated and reviewed: [normal multi-user zero balances](../output/playwright/ui-polish/normal-multiuser-zero-balances.png), [390px dialog](../output/playwright/ui-polish/mobile-dialog.png), and [native 200% zoom form](../output/playwright/ui-polish/native-200-percent-transaction.png). The existing gate also covers 320px layouts, focus trapping/restoration, validation/drafts, long email handling and reduced motion. The normal-server log assertion passed: generated test credentials, tokens and financial payload markers were absent.

No financial integrity defect was identified and no financial protocol change was made. Development-time lint/format findings were corrected before the final successful runs. Hosted security/recovery limitations above remain blockers to claiming deployment readiness.

Local tests use only generated, owned MongoDB databases. The new provisioning suite asserts removal of each of its owned targets; the existing integration FD guard serializes files and waits for MongoDB's natural descriptor cleanup without raising limits or restarting the shared container. Browser runners own and clean their own processes/databases. No persistent financial records are changed.

A final read-only inventory checked the 43 generated database names observed in these run logs: **zero remained**. This check performed no database deletion.

## Remaining blockers and approval boundaries

Before resource creation/execution, the operator must approve provider accounts/terms/free-tier controls, target identities, origin, network allowlists and separate credentials. Before writes, prove Vercel transforms/cookies/cache behavior, the exact Render forwarding chain and Atlas schema/role support. Before accepting recoverability, complete the encrypted hosted backup/isolated restore drill and independently retained key/archive retrieval. Platform token-log handling and sleeping-service scheduling limitations must be accepted or resolved.

**Preparation does not authorize any of those actions.** All cloud setup, hosted provisioning invocation, secret configuration, route activation, service startup, failure injection, role probes, backup/restore and eventual deployment require a separate operator instruction. No public release is recommended by this plan. If a provider contract fails, stop at that boundary and review the small single-origin alternative rather than weakening the application contracts.
