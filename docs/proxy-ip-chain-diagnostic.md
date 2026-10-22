# Temporary Vercel → Render IP-chain diagnostic

Prepared 2026-10-22. **Local preparation only; hosted execution NOT RUN.** No new endpoint, deployment, hosted settings change or database mutation is authorized here. Keep the rehearsal stopped for financial writes until the chain is proven. Use only a previously authorized generated account.

## What is being tested

The current application accepts only `TRUST_PROXY_HOPS=0` without an ingress secret or `2` with protected ingress. The ingress check precedes parsing/authentication. Existing tests prove the assumed two-hop chain ignores extra left prefixes, but cannot establish what Vercel and Render actually send.

[Express numeric trust](https://expressjs.com/en/guide/behind-proxies/) walks from `req.socket.remoteAddress` through X-Forwarded-For **right to left**. With two trusted hops, the expected view is:

```text
Express socket peer             XFF rightmost              XFF second from right
Render-facing internal peer  ←  Vercel-facing proxy hop  ←  actual client egress
hop 0 (trusted)                 hop 1 (trusted)            hop 2 = req.ip
```

These are observable roles, not a guarantee of three physical machines. Render may use internal load balancers/NAT. Labels alone cannot establish provider ownership of an address. [Vercel's request-header documentation](https://vercel.com/docs/headers/request-headers#x-forwarded-for) describes visitor IP forwarding and overwrite behavior. The hosted comparison below tests the actual path; if necessary, obtain provider confirmation privately rather than inferring infrastructure from an address or reverse DNS.

If Render delivers a shorter chain such as `XFF: forged, real-client`, Express with trust 2 selects `forged`. If it delivers more trusted intermediaries, Express may select a proxy instead of the client. **Either mismatch blocks this rehearsal. Do not change trust to true, increase/decrease hop counts experimentally on the live service, or remove ingress protection.**

## Instrumentation and bounds

`backend/src/middleware/proxy-ip-diagnostic.middleware.js` is a passive observer installed after protected ingress. It changes no request, response or rate-limit configuration. It emits a record only after a successful authenticated **GET `/api/auth/me`** with no query string, exact configured Origin, a valid separate diagnostic token, and an allowlisted probe label. It creates no diagnostic route and gives no diagnostic information in HTTP responses. A normal 200 alone does not establish that a record was emitted.

Activation requires both Render-only settings:

- `PROXY_IP_DIAGNOSTIC_TOKEN`: independent random 32 bytes encoded as 64 hex characters, distinct from JWT and ingress secrets. Do not give it to Vercel or the frontend.
- `PROXY_IP_DIAGNOSTIC_UNTIL`: ISO UTC deadline at most **15 minutes ahead at process startup**. It is checked again when emitting. An expired valid window stays silent, including after restart; it never re-arms itself. Partial/invalid activation or an excessive future deadline fails startup with variable names only. Remove both settings during cleanup.

Disabled by default. At most **20 records per app instance**. Keep one Render instance and the same token for the two-network comparison. A restart resets the counter but never extends the absolute deadline. Selected requests are authenticated reads; existing login limits, financial limits, CORS, CSRF and ingress checks remain unchanged. No CORS headers are added for diagnostic headers: use a private CLI, not browser JavaScript.

Each log record contains only an event name, allowlisted probe label, local sequence number, fixed trust count, bounded XFF element count and four 24-hex HMAC tags:

| Field            | Input represented privately                         |
| ---------------- | --------------------------------------------------- |
| `socketTag`      | Socket peer address, expected Render-facing peer    |
| `rightmostTag`   | Rightmost XFF entry, expected Vercel-facing hop     |
| `secondRightTag` | Second-rightmost XFF entry, expected client egress  |
| `resolvedTag`    | Actual Express `req.ip` used by IP-based middleware |

No IP address, complete forwarding header, request body, cookie, user ID, JWT, ingress/diagnostic token or arbitrary header text is logged. Malformed/oversized XFF yields null positional tags/count rather than raw data. IP normalization includes IPv6 and IPv4-mapped IPv6. Tags remain sensitive pseudonymous operational evidence: restrict log access and retention. The token keys the HMAC and allows offline guessing; do not retain it with shared log evidence.

## Operator procedure — only after separate authorization

1. Review/test the exact code and arrange two direct client networks: **A**, for example home broadband; **B**, a cellular hotspot with Wi-Fi disconnected. Use the same operator device if possible. Disable VPNs, corporate HTTP proxies and debugging interceptors. Keep HTTPS verification enabled. Use IPv4 consistently for this pass; IPv6 requires its own known egress and a separately planned pass, not mixed baselines. Confirm the networks have **different actual public egress IPv4 addresses** using an existing trusted network diagnostic or approved public-IP checker. A router WAN address behind CGNAT is insufficient. Record each privately; do not send account credentials or cookies to an IP-checking service. If independent egress cannot be established, the result is inconclusive.

2. Confirm application/platform access logging and any APM/debug tooling do not capture request headers or cookies; disable header capture through the later approved process, or stop if this cannot be ensured. Use a private directory outside the repository, permission 0700, and files 0600. Disable shell tracing, terminal recording and CLI HTTP tracing. In an operator-controlled shell, create temporary activation values without printing them:

   ```bash
   umask 077
   mkdir -p "$HOME/.tallynest-ip-check"
   chmod 700 "$HOME/.tallynest-ip-check"
   python - <<'PY'
   from pathlib import Path
   from secrets import token_hex
   from datetime import datetime, timedelta, timezone
   p = Path.home() / '.tallynest-ip-check' / 'activation.env'
   until = (datetime.now(timezone.utc) + timedelta(minutes=14)).isoformat().replace('+00:00', 'Z')
   p.write_text('PROXY_IP_DIAGNOSTIC_TOKEN=' + token_hex(32) + '\nPROXY_IP_DIAGNOSTIC_UNTIL=' + until + '\n')
   p.chmod(0o600)
   PY
   ```

   Under the later authorization, deploy this reviewed backend instrumentation and privately apply **only those two temporary Render settings** using the provider's protected editor. Preserve the existing ingress secret, exact `CLIENT_ORIGIN=https://tallynest-plum.vercel.app`, `TRUST_PROXY_HOPS=2` and all other security settings. Do not paste activation into chat, tickets, Git, public logs or Vercel. Generate a fresh window if deployment/startup takes too long. Verify clock synchronization. No Atlas configuration change or new data is required.

3. Obtain a still-valid session for the previously authorized generated account using normal HTTPS login. Store only its host-scoped session cookie in a private Netscape-format curl cookie jar at `$HOME/.tallynest-ip-check/cookies.txt` (0600), using a trusted local cookie export procedure. Treat this jar as a credential. Do not export the full browser profile, print cookies or copy tokens into shell arguments. The normal 900-second session may expire during preparation; repeat normal login if needed, respecting existing rate limits. The diagnostic itself performs only `/api/auth/me` reads.

4. Create a private curl config without exposing the diagnostic token in the process arguments:

   ```bash
   python - <<'PY'
   import json
   from pathlib import Path
   d = Path.home() / '.tallynest-ip-check'
   values = dict(line.split('=', 1) for line in (d / 'activation.env').read_text().splitlines())
   lines = [
       'url = "https://tallynest-plum.vercel.app/api/auth/me"',
       'request = "GET"', 'ipv4', 'silent', 'show-error',
       'proxy = ""', 'proto = "=https"', 'max-time = 90',
       'output = "/dev/null"', 'write-out = "%{http_code}\\n"',
       'header = "Origin: https://tallynest-plum.vercel.app"',
       'header = ' + json.dumps('X-TallyNest-Proxy-Diagnostic: ' + values['PROXY_IP_DIAGNOSTIC_TOKEN']),
       'cookie = ' + json.dumps(str(d / 'cookies.txt')),
   ]
   p = d / 'probe.curl'
   p.write_text('\n'.join(lines) + '\n')
   p.chmod(0o600)
   PY
   ```

   Do not add `--verbose`, `--trace`, `--location`, `--insecure`, `--cookie` with literal credentials, or the real ingress secret. `--disable` below suppresses a preexisting `.curlrc`; `proxy=""` suppresses environment HTTP proxies. The config prints only status codes and discards account response bodies.

5. On network A run these **eight requests sequentially**, correlating each allowlisted label with a single sanitized Render event. Each should return 200. A missing record, 401, 403, timeout or redirect is not a passing probe: diagnose expiry/activation/ingress without logging credentials. Render cold start may consume the window; do not extend the deadline beyond the bound.

   ```bash
   curl --disable --config "$HOME/.tallynest-ip-check/probe.curl" -H 'X-TallyNest-Proxy-Probe: A-baseline'
   curl --disable --config "$HOME/.tallynest-ip-check/probe.curl" -H 'X-TallyNest-Proxy-Probe: A-xff-single' -H 'X-Forwarded-For: 203.0.113.99'
   curl --disable --config "$HOME/.tallynest-ip-check/probe.curl" -H 'X-TallyNest-Proxy-Probe: A-xff-chain' -H 'X-Forwarded-For: 198.51.100.88, 203.0.113.99'
   curl --disable --config "$HOME/.tallynest-ip-check/probe.curl" -H 'X-TallyNest-Proxy-Probe: A-xff-duplicate' -H 'X-Forwarded-For: 203.0.113.99' -H 'x-forwarded-for: 198.51.100.88'
   curl --disable --config "$HOME/.tallynest-ip-check/probe.curl" -H 'X-TallyNest-Proxy-Probe: A-xff-short' -H 'X-Forwarded-For;'
   curl --disable --config "$HOME/.tallynest-ip-check/probe.curl" -H 'X-TallyNest-Proxy-Probe: A-real-ip' -H 'X-Real-IP: 203.0.113.99' -H 'X-Vercel-Forwarded-For: 198.51.100.88'
   curl --disable --config "$HOME/.tallynest-ip-check/probe.curl" -H 'X-TallyNest-Proxy-Probe: A-forwarded' -H 'Forwarded: for=203.0.113.99;proto=http' -H 'X-Forwarded-Host: attacker.invalid' -H 'X-Forwarded-Proto: http'
   curl --disable --config "$HOME/.tallynest-ip-check/probe.curl" -H 'X-TallyNest-Proxy-Probe: A-repeat'
   ```

   Switch to network B, independently confirm its egress, and repeat the same eight commands with **every label changed from `A-` to `B-`**. Do not change the token, origin, trust setting or account. Eight per network leaves four records of headroom. The same public egress on both networks cannot establish client separation.

6. Compute expected tags offline. For each known public client IP and the spoof fixtures `203.0.113.99`/`198.51.100.88`, create a private JSON file containing `{"token":"<temporary diagnostic token>","ip":"<one IPv4 address>"}` with a local editor; never print it. Run from the repository root:

   ```bash
   node backend/scripts/proxy-ip-tag.js < "$HOME/.tallynest-ip-check/comparison.json"
   ```

   Only the comparison tag is printed. Use the same literal token string/case as activation. Compare the resulting tags to the sanitized Render records; do not copy raw addresses into provider logs. Sequence counts are instance-local, so match the probe label and narrow operator time window as well.

7. Confirm direct-origin rejection with **no cookies or diagnostic/ingress token**:

   ```bash
   curl --disable --ipv4 --proxy '' --silent --show-error --max-time 90 --proto '=https' --output /dev/null --write-out '%{http_code}\n' \
     -H 'Origin: https://tallynest-plum.vercel.app' -H 'X-Forwarded-For: 203.0.113.99, 198.51.100.88' \
     https://tallynest-api-rehearsal.onrender.com/api/auth/me
   ```

   Expect **403** and no diagnostic event. Safe health is intentionally not evidence of ingress protection. Do not send the real ingress secret directly from a client to construct a synthetic shortcut path.

## Acceptance and stop conditions

For both networks, require `xffCount=2`, non-null `socketTag`, `rightmostTag`, `secondRightTag` and `resolvedTag`, and `resolvedTag = secondRightTag = independently known client tag`. The rightmost hop must differ from the client tag; socket/rightmost are separate observed slots, even if infrastructure happens to reuse an address. Private provider confirmation must resolve any ambiguous role; HMAC tags alone do not prove provider IP ownership. Socket/rightmost tags may change between requests because providers can use different ingress nodes. Do not require one globally constant proxy IP.

All spoof variants must leave `resolvedTag` equal to that network's known baseline. It must never equal either spoof fixture. Network A and B must produce distinct resolved client tags. Baseline/repeat must agree unless independent egress changed; if it changed, rerun a fresh controlled window. More/fewer entries, invalid/null fields, selected proxy/forged addresses, variable path lengths, inconsistent repeats, unexpected direct-origin access, missing evidence or unavailable logs are **NO-GO/inconclusive**, never permission to relax trust. Stop the rehearsal, retain only sanitized findings and investigate the actual provider chain in a separately reviewed design.

This is a bounded sample of one deployment and IP family, not a guarantee for every region, IPv6, custom domain, provider change or alternate access path. Reverify after topology changes. Normal rate limits remain intact; this read-only test does not deliberately exhaust authentication limits or mutate financial data.

## Cleanup — required even on failure

1. Stop probes. Under the same later authorized operator session, remove **both** `PROXY_IP_DIAGNOSTIC_*` settings from Render promptly; keep `PROXY_SHARED_SECRET` and `TRUST_PROXY_HOPS=2` unchanged. Restart/redeploy through the approved process so no active diagnostic instance remains. The absolute expiry already stops emission and stays expired across restarts; removal avoids retaining dormant diagnostic credentials.
2. Remove the temporary middleware module/import/app hook and injected diagnostic test option, its two env schema fields/refinement/mapping and example comments, the fingerprint CLI and diagnostic-only tests (including the added env test/default field assertion). Keep the existing ingress/caching/routing protections and proxy-ingress tests. Review the diff rather than resetting unrelated work. Rerun backend tests, lint and formatting; deploy removal only under the later authorization.
3. Verify ordinary authenticated `/api/auth/me` still works and sends no diagnostic details. With a still-private curl config and a valid session, one selected probe after deactivation must produce no new diagnostic event; if it does, stop and confirm all instances/deployments were replaced. Do not retain credentials merely to perform this check if they have expired.
4. Clear the generated account session via normal logout (not financial mutations), remove private cookie/config/activation/comparison files and dispose of any backups according to the workstation's storage policy. Do not promise secure erase on SSD/synced storage. Revoke/delete copies of the diagnostic token; no JWT/ingress rotation is needed unless actual exposure is suspected.
5. Retain only the minimum sanitized pass/fail matrix, revision, time window, labels, selected tags/counts and limitations in a restricted operator record. Delete temporary diagnostic logs/exports where provider retention controls allow; document any unavoidable retention. Never retain cookie jars or activation files with the evidence.

## Local validation

The isolated diagnostic tests exercise protected/authenticated selection, redaction, disabled/expired/exhausted behavior, sink failures, canonical IP tags, the assumed chain and a deliberately shorter vulnerable chain. No real provider, MongoDB or client-network verification is implied. Record hosted findings only after executing the procedure above.

Local results on 2026-10-22: final backend suite **338/338 passed**; frontend **267/267 passed**. Backend/frontend/shared lint, formatting, production Vite build and the 33-file ingress-secret canary scan passed. Both production dependency audits reported zero vulnerabilities. `verify:fast` passed; after the final malformed-header regression was added, backend tests/lint and repository formatting passed again. Five runbook shell blocks and their embedded Python were syntax-checked without executing them. Evidence: [full verification](../output/proxy-ip-diagnostic-verify.log), [final backend suite](../output/proxy-ip-diagnostic-backend-final.log), [final formatting](../output/proxy-ip-diagnostic-format-final.log). Logs are local/ignored. Hosted probes, two-network comparisons, live MongoDB checks, deployments and hosted configuration changes were **not run**.
