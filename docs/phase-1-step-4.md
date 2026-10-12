# Phase 1, Step 4 — implementation and verification

Verification snapshot: 2026-10-13. Node.js 24.21.0. Changes are uncommitted.

The React 19 frontend provides login, registration, initial session restoration,
a protected welcome page, read-only account details, mobile navigation, and a
not-found screen. Finance modules remain roadmap content without financial values.
The backend authentication contract and database schema are unchanged. Backend
changes are limited to ESLint configuration, its script, and development dependencies.

## Executed checks

| Check | Result | Scope |
| --- | --- | --- |
| Frontend `npm ci` | Passed | Lockfile installation |
| Backend `npm ci` | Passed | Lockfile installation |
| Frontend `npm test` | 36 passed, 0 failed | Four Vitest files; isolated API mocks |
| Backend `npm test` | 32 passed, 0 failed | Existing built-in Node.js runner suite |
| Frontend/backend `npm run lint` | Passed | ESLint 10; zero warnings allowed |
| Frontend `npm run format:check` | Passed | Prettier |
| Frontend `npm run build` | Passed | Production bundle; no chunk-size warning |
| Frontend/backend `npm audit --omit=dev` | 0 vulnerabilities | Runtime dependency trees |
| `git diff --check` | Passed | Working tree whitespace |

The frontend tests cover normalization and Unicode password boundaries, accessible
form errors, successful/failed login and registration, loading/disabled controls,
protected routes, initial restoration and retry, logout and its failure case,
stale restoration after logout, session loss/401, focus revalidation, mobile
navigation, not-found behavior, and Axios cookies/CSRF configuration. Public-user
response parsing drops unexpected sensitive fields.

## Live browser verification

A real Chromium browser used the Vite frontend at `localhost:5173` and Express at
`localhost:5000`, connected to a disposable `sfm_ui_test_*` MongoDB database through
a process-only MONGO_URI override. Development data was not modified.

Executed successfully:

- Register through the React form, receive HTTP 201, and enter the protected shell.
- Inspect cookie metadata without printing token values: HTTP-only and SameSite=Lax.
- Confirm JavaScript cannot read the access cookie and both browser storage areas remain empty.
- Reload and restore the account through `/api/auth/me`.
- Navigate from the mobile drawer to actual account details and confirm background content cannot receive focus while the native modal is open.
- Sign out, verify the browser cookie is removed, and return to login.
- Submit an incorrect password and show the generic login error from HTTP 401.
- Submit the correct password and return to the originally requested protected route.
- Clear the test cookie, trigger focus revalidation, and verify `/me` 401 removes protected content and displays the session-ended message.
- Start again after clean installs and reload login without JavaScript exceptions. Anonymous `/me` 401 resource messages are expected in the browser's developer console.
- Inspect desktop layouts at 1440×1000 and mobile layouts at 390×844.

A transient development HMR hook warning occurred while changing the Motion entry
point and reoptimizing dependencies. Full reload and fresh-start verification did
not reproduce it. No backend API adjustment was needed. Verification servers and
browsers are stopped; the disposable database was removed. The named MongoDB
development volume is retained.

## Review artifacts

Browser artifacts are intentionally Git-ignored, under `output/playwright/`, and
available in this working copy for review:

- `login-desktop.png`
- `register-desktop.png`
- `workspace-desktop.png`
- `workspace-mobile.png`
- `account-desktop.png`
- `account-mobile.png`
- `session-expired-mobile.png`
- `not-found-desktop.png`

These screenshots use a disposable test account, not real financial data.

## Limits and local operation

- Production HTTPS hosting, reverse-proxy behavior, and the Secure production cookie
  were not exercised by this frontend browser run. Existing backend tests cover
  production cookie attributes. React routes need a serving-layer SPA fallback.
- Production builds use same-origin `/api` when VITE_API_URL is absent. Set a public,
  same-site HTTPS API URL at build time for separate hosts. Local preview against
  Express can be built with `VITE_API_URL=http://localhost:5000/api npm run build`.
- The existing stateless JWT limitations remain: logout does not revoke copied
  tokens, and there are no refresh tokens. Session checks occur on load, authenticated
  window focus, and protected API 401 responses; no timer refresh is implemented.
- Existing backend install warnings report three high-severity development-only
  findings in nodemon's braces/chokidar chain. No forced downgrade was applied.
- Auth rate limits remain process-local. Profile editing and finance features are
  intentionally unimplemented.

See the root README for two-terminal startup instructions and environment guidance.

## Frontend file tree

```text
frontend/
├── .env.example
├── .prettierignore
├── .prettierrc.json
├── eslint.config.js
├── index.html
├── package-lock.json
├── package.json
├── public/
│   └── favicon.svg
├── src/
│   ├── App.jsx
│   ├── components/
│   │   ├── AccountAvatar.jsx
│   │   ├── Brand.jsx
│   │   ├── MobileNavigation.jsx
│   │   ├── Sidebar.jsx
│   │   ├── auth/
│   │   │   ├── AuthForm.jsx
│   │   │   └── SessionState.jsx
│   │   └── ui/
│   │       ├── Button.jsx
│   │       ├── Field.jsx
│   │       ├── Notice.jsx
│   │       └── PageTransition.jsx
│   ├── context/
│   │   ├── AuthContext.js
│   │   └── AuthProvider.jsx
│   ├── hooks/
│   │   └── useAuth.js
│   ├── layouts/
│   │   ├── AppLayout.jsx
│   │   └── AuthLayout.jsx
│   ├── main.jsx
│   ├── pages/
│   │   ├── AccountPage.jsx
│   │   ├── LoginPage.jsx
│   │   ├── NotFoundPage.jsx
│   │   ├── RegisterPage.jsx
│   │   └── WelcomePage.jsx
│   ├── services/
│   │   ├── api.js
│   │   └── auth.js
│   ├── styles/
│   │   ├── auth.css
│   │   ├── base.css
│   │   ├── index.css
│   │   ├── responsive.css
│   │   └── workspace.css
│   ├── test/
│   │   ├── App.test.jsx
│   │   ├── api.test.js
│   │   ├── authService.test.js
│   │   ├── setup.js
│   │   └── validation.test.js
│   └── utils/
│       ├── authErrors.js
│       └── validation.js
└── vite.config.js
```
