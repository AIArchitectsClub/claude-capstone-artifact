# Detecting the target backend

Run this once, at the start of a bootstrap (an already-scaffolded `k6/`
records what it targets in `k6/.suite-profile.json`, so detection isn't
repeated on later runs).

This skill load-tests the **API layer directly** — never through a frontend
dev server. A frontend build serves static assets and is a different kind of
load test (CDN/static-hosting capacity, not transactional NFRs); if the user
specifically wants that too, treat it as a separate, explicitly-requested
addition, not part of the default flow.

## 1. Find the backend root

Walk the repo root's immediate subdirectories (don't assume a fixed name like
`backend/` — a scaffolded app may rename it):

- **Backend root** = the directory containing `requirements.txt` +
  `app/main.py` importing FastAPI (Python profile), or a `server/` directory
  with `index.js`/`index.ts` calling `app.listen` (Express profile). If
  neither pattern matches, ask the user directly (Profile C).

## 2. Known profiles

### Profile A — FastAPI + SQLAlchemy (`build-fullstack-angular-python-app` output)

Validated against this skill's reference app, `car-rental-portal-new`:

- Start command: `<backendDir>/.venv/Scripts/python.exe -m uvicorn
  app.main:app --host 127.0.0.1 --port <port>` (Windows path shown; use
  `.venv/bin/python` on macOS/Linux). Config via `pydantic_settings` reading
  `<backendDir>/.env`, key `DATABASE_URL` (`sqlite:///...` or
  `mysql+pymysql://...`).
- Schema + seed data created **at import time**
  (`Base.metadata.create_all` then a `seed_if_empty` call as module-level
  code in `app/main.py`) — starting the process against an empty database is
  enough to get a fully seeded one. No separate migrate/seed step.
- Health endpoint: `GET /api/health` → `{"status": "ok"}`. Poll this before
  starting k6, don't assume a fixed startup time.
- Auth: `POST /api/auth/register` (JSON, camelCase-aliased —
  `{name, email, password}`, all snake_case names also accepted since the
  schema uses `populate_by_name=True`), `POST /api/auth/token` (**OAuth2
  password grant, form-encoded**, `username`/`password` — email goes in
  `username`), bearer token in the JSON response's `access_token`.
- Core resource endpoints (this reference app's domain — a booking/rental
  app; adjust names for a different domain's equivalents):
  `GET /api/cars` (list, unauthenticated), `GET /api/cars/{id}`,
  `GET /api/cars/{id}/pricing?start&end`, `GET /api/cars/{id}/bookings`,
  `POST /api/bookings` (auth required, JSON body camelCase:
  `carId, driverName, email, phone, pickupLocation, startDate, endDate,
  paymentMethod`), `GET /api/bookings/me`, `POST /api/bookings/{id}/cancel`.
- Reset script: `scripts/reset_sql_test_db.py.tmpl` imports the backend's own
  `app.database.Base` and `app.models` (adjust the import path to match the
  actual backend package name) and calls `Base.metadata.drop_all` against the
  test `DATABASE_URL` — the next process launch's own `create_all` +
  reseed recreates it.

### Profile B — Express (`build-fullstack-react-app` output)

- Start command: `node server/index.js` (or the repo's documented start
  script), `PORT` env var. DB: Postgres, migrated via `server/migrate.js`,
  seeded via `server/seed.js`.
- Auth: Better Auth session **cookies**, not bearer tokens — k6 needs
  `http.cookieJar()` per-VU rather than an `Authorization` header; adjust
  `templates/k6/lib/http-client.js`'s auth helper accordingly when scaffolding
  against this profile.
- **Not yet execution-verified by this skill** (no reference instance
  available at authoring time — reasoned from the sibling
  `e2e-test-suite-ui-playwright` skill's own Profile B notes, which carry the
  same caveat). Confirm start command, port, and the exact auth endpoint
  shapes against the actual repo before wiring `k6/.suite-profile.json`, and
  say so in the bootstrap report if anything had to be adjusted.

### Profile C — generic / unrecognized stack

Ask the user directly (`AskUserQuestion`) for: the backend start command +
port, the database env var name, the health-check path (or whether one
exists at all — if not, poll the API root or a known-cheap GET endpoint
instead), the auth flow's register/login endpoints and payload shape, and 2-4
of the app's core read/write endpoints worth putting under load. Don't guess
silently — a wrong guess here means load lands on the wrong process or,
worse, a real database.

## 3. Record the profile

Once detected (or supplied), write `k6/.suite-profile.json` in the target
repo (committed, no secrets — same convention as the Playwright sibling
skill's profile file, so a fresh clone can run the suite without
re-detecting the stack):

```json
{
  "profile": "fastapi-sqlalchemy",
  "backendDir": "backend",
  "backendStartCmd": ".venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port {port}",
  "backendPortDefault": 8000,
  "backendTestPort": 8020,
  "healthPath": "/api/health",
  "dbEnvVar": "DATABASE_URL",
  "authMode": "bearer",
  "registerPath": "/api/auth/register",
  "registerBody": {"name": "string", "email": "string", "password": "string"},
  "loginPath": "/api/auth/token",
  "loginBodyType": "form-urlencoded",
  "coreReadEndpoints": ["/api/cars", "/api/cars/{id}", "/api/cars/{id}/pricing", "/api/cars/{id}/bookings"],
  "coreWriteEndpoint": "/api/bookings"
}
```

`backendTestPort` should be clearly outside the app's normal dev range (and
outside any other test suite's range — this skill's reference app already
uses port 8010 for the Playwright suite's isolated backend, so 8020 keeps
them from ever colliding if both are run around the same time).
