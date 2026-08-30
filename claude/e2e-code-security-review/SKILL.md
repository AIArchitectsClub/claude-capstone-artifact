---
name: e2e-code-security-review
description: >-
  Scaffold a real, repeatable code-security test suite into an existing full-stack web app
  (React + Express + Postgres + cookie-auth apps — the shape the build-fullstack-* skills
  produce) and run it on demand before merging. Covers the OWASP Top 10, authentication &
  authorization, SQL injection, sensitive-data / PII / token exposure, CORS misconfiguration,
  security headers, and dependency CVEs — as a STATIC layer (a self-contained Node scanner +
  npm audit + secret scan, auto-using semgrep/gitleaks/osv-scanner when installed) and a
  DYNAMIC layer (Playwright request/browser probes against the running production build).
  ALWAYS asks the user for a dedicated throwaway test database connection string first, every
  run, and does nothing until it has one — the suite migrates, seeds and fires injection
  payloads at that DB and must never touch the app's own. Use whenever the user wants security
  tests, a vulnerability scan, an OWASP check, SAST/DAST, a pen-test-style regression gate, or
  "check for security bugs before merge".
---

# Code Security Review Suite (static + dynamic)

You are adding a **committed, repeatable security test suite** to an already-built full-stack web
app, so the user can run `npm run security` before every merge and trust a green result to mean
"no known security regression".

## FIRST, EVERY TIME: ask for the test database connection string

Before scaffolding, reading the app, or running anything, **ask the user for a dedicated test
database connection string** and wait for their answer. Ask every run — never reuse one from
memory or a previous session, never assume, never fall back to the app's own database.

> "This suite needs a dedicated throwaway Postgres database — it runs migrations, seeds it, and
> fires SQL-injection payloads at it on every run, so it must never touch your app's DB. Paste a
> connection string for a **separate** database (a fresh Neon project, a Neon branch, or a local
> Postgres)."

If the user already pasted one, confirm it back and continue. Otherwise this is a hard stop — do
not create files or run tools until you have the string. Write it to `security/.env.security` as
`TEST_DATABASE_URL=` (gitignored). The generated `global-setup.js` also enforces this at runtime:
it **hard-fails** if `TEST_DATABASE_URL` is unset or resolves to the same database as the app's
own `.env` `DATABASE_URL` (pooled vs. direct Neon endpoints both count). That guard is a
backstop — asking up front is the rule.

## The two layers

| layer | command | what it is |
| --- | --- | --- |
| static | `npm run security:static` | Node scanner (~25 OWASP/CWE-tagged rules over source) + `npm audit` gate + secret scan + optional `semgrep`/`osv-scanner`/`gitleaks`. No DB, no server. |
| dynamic | `npm run security:dynamic` | Playwright suite that boots the app's **production build** against the test DB and probes the live API/pages for OWASP Top-10 issues. |
| both | `npm run security` | static then dynamic — the merge gate. |
| advisory | `npm run security:advisory` | non-gating "consider adding" checks (Secure cookie on https, HSTS length, CSP reporting, …). |

## Baseline must be green

A security gate is only useful if a clean checkout passes. Apps almost always ship missing some
standard protection (security headers, `X-Powered-By`, login rate-limit, a strict CSP). Two ways
to handle each gap — decide with the user:

- **Harden the app now** (preferred): a small, reviewed diff to `server/` (helmet, `x-powered-by`
  off, Better Auth `rateLimit`, prod CSP, `/api` 404 + `no-store`, TRACE/TRACK reject, per-proxy
  client IP). Then the corresponding checks become **enforced** regression gates.
- **Advisory**: leave the app untouched; the check ships under the `@advisory` tag (reported by
  `security:advisory`, not part of `npm run security`) until the app adopts it.

Only things SkyBook already did right become enforced with zero hardening. See
`references/adapting-to-a-new-app.md` for the exact hardening list.

## Workflow

### 1. Interview + safety gate
Ask for the throwaway DB string (above). Read the app's `.env`; note its real `DATABASE_URL` and
confirm the test string is different. Identify: dev vs prod start commands, a free test port, the
migration commands, the auth mechanism + session cookie name.

### 2. Map the security surface
Read `references/adapting-to-a-new-app.md` and `references/owasp-coverage.md`. List every route,
every state-changing / auth endpoint, and every place user input reaches SQL / HTML / a header /
the filesystem / an outbound request. Note whether there's a build step and what `dist/` contains.

### 3. Copy the static scanner
`assets/static/*` → `security/static/`. It is generic. Run it, then for each finding: fix it, or
waive a **verified** false positive inline with `// security-scan-ignore: <rule-id> -- <reason>`
(the reason is mandatory). Tune rule scope only if a rule is systematically wrong for this stack.

### 4. Apply the hardening baseline
With the user's OK, make the `server/` changes from `references/adapting-to-a-new-app.md`. Rebuild
and load the app once to confirm the CSP doesn't break it.

### 5. Copy the dynamic infra + specs
`assets/playwright.config.js.template`, `assets/global-setup.js.template`,
`assets/fixtures.js.template`, `assets/helpers-*.template`, `assets/seed-data.js.template`,
`assets/dynamic/*.spec.js.template` → `security/`. Adapt endpoints, table names, the seed, and
the port. Keep `workers: 1`, the safety guard, and the prod `webServer` command as-is.

### 6. Wire
Add `security:static` / `security:dynamic` / `security:advisory` / `security` npm scripts;
`.gitignore` `security/.env.security`, `security/.seed-manifest.json`, `security/reports/`,
`security/playwright-report/`, `security/test-results/`. `@playwright/test` is usually already a
devDep (the e2e skill adds it); if not, add it pinned to the installed CLI version.

### 7. Validate
- `npm run security` → green. Run it **twice** back-to-back — still green, no manual cleanup.
- **Negative control, one per layer** (then revert): add a string-concatenated SQL query to a
  route → static goes red; remove a helmet header / re-enable `x-powered-by` → `a05-security-headers`
  goes red.
- If the app has a sibling suite (`tests/e2e/`), re-run it — hardening (esp. always-on rate
  limiting) can perturb it; the fix is a per-test `X-Forwarded-For` + `TRUSTED_IP_HEADER` in that
  suite's webServer env.

### 8. Hand off
`npm run security` before merging. `.env.security` and reports are gitignored; each teammate needs
their own `.env.security` with their own throwaway DB. Don't commit — offer commit messages (one
for the hardening, one for the suite) and let the user stage them.

## Reference files
- `references/owasp-coverage.md` — the Top-10 → concrete-check matrix (static vs dynamic, how to
  drive it, what to assert, enforced vs advisory), plus the non-Top-10 extras (CSRF-via-Origin,
  clickjacking, SRI, secret scan, HTTP method tampering, mass assignment, cache-control).
- `references/static-scanner.md` — the rule model, the `security-scan-ignore` syntax, the audit
  threshold + lockfile check, the secret patterns, and the optional external-tool hooks.
- `references/adapting-to-a-new-app.md` — surface-mapping checklist, the exact hardening baseline,
  and how to point the dynamic layer at a different stack.

## Assets (copy and adapt)
`static/{index,scan,rules,audit,secrets,external,report}.mjs`, `playwright.config.js.template`,
`global-setup.js.template`, `fixtures.js.template`, `helpers-raw.mjs.template`,
`helpers-db.mjs.template`, `helpers-payloads.mjs.template`, `seed-data.js.template`,
`env.security.example.template`, and
`dynamic/{a01-access-control,a02-crypto-and-data,a03-injection,a04-insecure-design,a05-security-headers,a05-cors,a05-misconfiguration,a07-auth-failures,a08-integrity,a10-ssrf,advisory}.spec.js.template`.
