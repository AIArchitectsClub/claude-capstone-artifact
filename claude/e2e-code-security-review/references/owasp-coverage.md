# OWASP Top 10 (2021) → concrete checks

`S` = static (`security/static/`), `D` = dynamic (`security/dynamic/`). Implement every row that
applies to the target app. "Drive via `hit()`/`ctx`" = the authenticated request helper/context;
these bypass the browser's own input constraints and hit the real trust boundary.

---

## A01 — Broken Access Control  (`a01-access-control.spec.js`)

| check | how | assert |
|---|---|---|
| protected endpoints need auth | D: `hit()` unauthenticated `GET/POST/DELETE` on each user-scoped route | `401` (never `200`, never `500`) |
| IDOR | D: user A creates a resource; user B reads the list / `DELETE`s A's id | B's list excludes it; `DELETE` → `403`/`404`; A's resource untouched |
| mass assignment | D: `POST` the create endpoint with `user_id`, `id`, `status`, `total_price`, `created_at` in the body | server ignores all — owner = session user, status = server default, id server-generated, price server-computed |
| method tampering | D: `PUT`/`PATCH` a resource route with no such handler | `404`/`405`/`501`, not a silent `200` |
| CSRF guard active | D: cookie-bearing `POST` to an auth mutation with no `Origin`, and with a cross-site `Origin` | `403` both; real session still valid afterwards |
| write route without auth middleware | S: `router-write-without-auth` (`PUT/PATCH/DELETE` + no `requireAuth`) | — |

## A02 — Cryptographic Failures  (`a02-crypto-and-data.spec.js`)

| check | how | assert |
|---|---|---|
| session cookie flags | D: read `Set-Cookie` from sign-up/sign-in | `HttpOnly`; `SameSite=Lax|Strict` (`Secure` is `@advisory` on http) |
| no secret in responses | D: sweep every endpoint; scan bodies | no `"password"`/`"passwordHash"`, no `$2[aby]$`/`$argon2` hash, not the auth secret, no `postgres://user:pass@` |
| session endpoint scope | D: `get-session` for A | contains only A; no other users; no password field |
| TLS verification | S: `tls-reject-unauthorized` (`rejectUnauthorized: false`) | fix, or waive with a scoped reason |
| weak randomness for security values | S: `weak-random-security` (`Math.random()` near token/otp/session/salt) | — |

## A03 — Injection  (`a03-injection.spec.js`)

| check | how | assert |
|---|---|---|
| SQLi | D: payload corpus into every query param, path param, and body id; login `email` | no `500`; body never carries a DB-error signature; row counts + table set unchanged; SQLi in `email` does not authenticate |
| XSS (stored) | D: store `<img onerror>` via a text field; render the page as that user in a real browser | payload returned verbatim as JSON; page never executes it (no `window.__xss`, no dialog); responses are `application/json` |
| CRLF / header injection | D: `%0d%0a`-laced param values | no injected response header / cookie |
| SQL string concatenation | S: `sql-string-concat`, `sql-template-interpolation-user-input` | — |
| unsafe HTML sink | S: `raw-html-sink` (`dangerouslySetInnerHTML`, `.innerHTML =`) | — |
| `eval` / dynamic code | S: `eval-usage` | — |
| command injection | S: `command-injection` (`exec`/`spawn` with input or `shell:true`) | — |

## A04 — Insecure Design  (`a04-insecure-design.spec.js`)

| check | how | assert |
|---|---|---|
| numeric field validation | D: junk + extreme values (`0`, `-1`, `1.5`, `1e12`, `"1 OR 1=1"`, `[]`, `{}`) | `4xx`, no row written |
| capacity / quota not bypassable | D: oversized direct request | rejected (`400`/`409`) |
| login rate limiting | D: N rapid bad sign-ins from one IP | a `429` appears |
| missing rate limit | S: `missing-rate-limit` (auth code present, no limiter configured) | — |

## A05 — Security Misconfiguration  (`a05-*.spec.js`)

| check | how | assert |
|---|---|---|
| `X-Powered-By` | D | absent |
| baseline headers | D: HTML + API responses | `X-Content-Type-Options: nosniff`; `X-Frame-Options ∈ {DENY,SAMEORIGIN}`; `Referrer-Policy` set; `Strict-Transport-Security` set |
| CSP | D: the HTML document | present; `default-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; `script-src` has no `'unsafe-inline'`/`'unsafe-eval'` |
| CORS | D: `Origin: https://evil.example` on GET, POST, and preflight `OPTIONS` | ACAO is not the evil origin and not `*`; if any ACAO is set it is never paired with `Allow-Credentials: true` |
| unknown API path | D: `GET /api/<random>` | JSON `404`, not the SPA HTML with `200` |
| error verbosity | D: force handler errors (bad JSON, oversized body, type-confused fields) | body is generic — no stack, no file paths, no SQL |
| TRACE / TRACK | D: raw `node:http` request (fetch forbids the method) | `4xx`/`5xx`, response does not echo the request |
| sourcemaps in prod | D + S | `dist/**` has no `.map`; assets carry no `sourceMappingURL`; `/assets/*.map` → `404` |
| no helmet / x-powered-by in code | S: `express-no-helmet`, `express-x-powered-by` | — |

## A06 — Vulnerable & Outdated Components  (`static/audit.mjs`)

`npm audit --json` — fail on `high`+`critical` (threshold `SECURITY_AUDIT_LEVEL`, default `high`).
`osv-scanner` also run if installed.

## A07 — Identification & Authentication Failures  (`a07-auth-failures.spec.js`)

| check | how | assert |
|---|---|---|
| user enumeration | D: sign-in with unknown email vs known email + wrong password (same source IP) | identical status **and** normalized body |
| weak password | D: sign up with `"1234"` | `4xx` |
| session invalidated on sign-out | D: capture a session cookie, sign out, replay it | replay → `401` |
| brute force | D: rate-limit check (see A04) | `429` |

## A08 — Software & Data Integrity Failures  (`a08-integrity.spec.js` + `static/audit.mjs`)

Lockfile present and committed. Built page loads only same-origin assets, or cross-origin ones
with `integrity=`. No sourcemaps shipped. (Extend with SRI / signed-artifact checks if the app
loads third-party scripts.)

## A09 — Security Logging & Monitoring Failures  (`static/rules.mjs`)

`sensitive-data-logged` — a log statement that may write `req.body` / headers / `password` /
`token`. Hard to test dynamically; keep it a static finding.

## A10 — SSRF  (`a10-ssrf.spec.js`)

Booking-style apps usually expose **no** fetch-by-user-URL surface — the spec feeds URL-shaped
values (`http://169.254.169.254/…`, `file://…`, `http://localhost:22`) into every param and
asserts no slow response (no outbound attempt), no error leak, no metadata/file content in the
body. `outbound-request-user-url` (S) flags `fetch(...)`/`axios(...)` built from request input.
If the app **does** fetch user URLs (webhooks, avatar-by-URL, link previews, PDF/HTML render),
replace the guard with real allow-list + block-internal-address assertions.

---

## Non-Top-10 extras worth a regression gate

- **Clickjacking** — covered by `X-Frame-Options` + CSP `frame-ancestors 'none'` (A05).
- **Cache-Control on authenticated responses** — `no-store` on `/api/**` (A02 table).
- **CSRF via SameSite** — session cookie `SameSite` never `None` (A01 table) + the Origin guard.
- **HTTP verb tampering / method override** — A01 method-tampering row; also check no
  `X-HTTP-Method-Override` handling if not intended.
- **Host header injection** — if the app builds URLs from `Host`, add a spec sending
  `Host: evil.example` and asserting links/redirects still use the configured origin.
- **Open redirect** — `open-redirect` (S); add a D check if the app has any `?redirect=` / `?next=`.
