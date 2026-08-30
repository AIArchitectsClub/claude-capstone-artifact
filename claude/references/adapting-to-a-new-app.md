# Adapting the security suite to a new app

## 1. Surface map (write this down before touching code)

- **Routes** — every path, and for each: auth required? state-changing? what user input does it
  take?
- **Auth** — mechanism (Better Auth cookie session? JWT? bearer token?), the session cookie name,
  the sign-up / sign-in / sign-out endpoints and body shapes.
- **Sinks** — where does request input reach: SQL, HTML, response headers, the filesystem, an
  outbound HTTP request, a shell command, a template?
- **Build** — is there a `npm run build` producing `dist/`? What does `dist/index.html` reference?
- **Commands** — dev start, prod start, DB migration(s), a free test port (not the app's dev port
  or the e2e suite's).

## 2. The hardening baseline (apply with the user's OK — see SKILL.md step 4)

For an Express + Better Auth app, this is what takes SkyBook's baseline from "several reds" to
"fully green enforced". Adjust per stack.

**`package.json`** — add `helmet`.

**`server/index.js`** (order matters — all of this before the route handlers):
```js
app.disable("x-powered-by");

// reject TRACE/TRACK (they otherwise fall through to the SPA handler and 200)
app.use((req, res, next) => {
  if (req.method === "TRACE" || req.method === "TRACK")
    return res.status(405).type("text/plain").send("Method Not Allowed");
  next();
});

app.use(helmet({
  crossOriginEmbedderPolicy: false,               // would block the app's own assets
  hsts: { maxAge: 31536000, includeSubDomains: true },
  contentSecurityPolicy: isProd ? { directives: {
    "default-src": ["'self'"], "base-uri": ["'self'"], "font-src": ["'self'", "data:"],
    "form-action": ["'self'"], "frame-ancestors": ["'none'"], "img-src": ["'self'", "data:"],
    "object-src": ["'none'"], "script-src": ["'self'"], "script-src-attr": ["'none'"],
    "style-src": ["'self'", "'unsafe-inline'"], "connect-src": ["'self'"],
  } } : false,                                     // CSP only in prod — Vite dev needs inline/eval/ws
}));

app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

// ... express.json({ limit: "100kb" }) ... route mounts ...

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));   // JSON 404 for unknown API paths
```
And in the prod SPA fallback, 404 anything with a file extension instead of serving `index.html`:
```js
app.use((req, res) => {
  if (path.extname(req.path)) return res.status(404).type("text/plain").send("Not found");
  res.sendFile(path.join(distDir, "index.html"));
});
```

**`server/auth.js`** (Better Auth):
```js
rateLimit: { enabled: true },   // on regardless of NODE_ENV — protects /sign-in, /sign-up (3/10s)
advanced: {
  ipAddress: {
    // behind a trusted proxy (Render/Cloudflare/nginx) set TRUSTED_IP_HEADER=x-forwarded-for so
    // rate limiting is per-client, not one global bucket. Unset otherwise (spoofable).
    ipAddressHeaders: process.env.TRUSTED_IP_HEADER ? [process.env.TRUSTED_IP_HEADER] : undefined,
  },
},
```

**Verify** after: `npm run build` and load the app — a wrong CSP shows as blocked scripts/styles
in the console.

## 3. Dynamic layer wiring

- `global-setup.js`: adjust `APP_ROOT` depth, the `TABLES` truncate list, the migration commands,
  and the resource `INSERT`. Keep the `dbIdentity()` safety guard verbatim.
- `playwright.config.js`: `webServer.command` = the app's **prod** start; set `TRUSTED_IP_HEADER:
  "x-forwarded-for"` in `webServer.env` so each test actor gets its own rate-limit bucket.
- `fixtures.js`: adjust the sign-up call + session-cookie extraction to the app's auth. Keep
  `userA`/`userB` **worker-scoped** and each on its own `X-Forwarded-For` (`fakeIp()`).
- `seed-data.js`: 1 roomy resource + 1 tiny-capacity resource is enough.

## 4. Non-Express / non-Better-Auth stacks

- **FastAPI / Django / Rails**: the dynamic specs are HTTP-level — only the auth fixture, the
  endpoint paths, and the hardening step change. Port the hardening to that framework's
  middleware (secure headers package, rate limiter, CORS config).
- **No build step**: drop the `npm run build` in `global-setup`, point `webServer` at the normal
  start command, and move the CSP / sourcemap / SRI checks to `@advisory` or delete them.
- **JWT / bearer auth**: the fixture captures the token from the login response and sends it as
  `Authorization: Bearer`; the "session dead after sign-out" check becomes "token rejected after
  revocation / past `exp`"; add a spec that a `alg:none` or wrong-signature token is rejected.

## 5. If the app has a sibling e2e suite

Always-on rate limiting will make its fixtures 429. Fix in that suite (not the app): add
`TRUSTED_IP_HEADER: "x-forwarded-for"` to its `webServer.env` and an auto-fixture that sets a
unique `X-Forwarded-For` per test (see `tests/e2e/fixtures.js#_perTestSetup` in the validated
SkyBook build). Re-run it to confirm green.
