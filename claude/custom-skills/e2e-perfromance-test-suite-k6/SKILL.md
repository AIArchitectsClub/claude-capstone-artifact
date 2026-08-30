---
name: e2e-perfromance-test-suite-k6
description: Scaffold and/or run a real, repeatable k6 load/performance test suite against a full-stack web app's API (validated on FastAPI+SQLAlchemy, generic fallback for other stacks), driven against an isolated backend process and an isolated test database that is never the app's own configured database — always asks for a fresh test DB URL, and always asks the user for concrete Concurrent Users / TPS / Peak Load / Latency / TAT targets before every run. Use when the user asks to add, build, or run load/performance/stress tests, wants to verify non-functional requirements (throughput, latency, turnaround time) before merging to prod, or asks to k6-test an API. Not for UI/functional regression testing — see e2e-test-suite-ui-playwright for that.
---

# k6 load / performance test suite

A **standing performance suite**, not a one-off demo: built once per app,
then run on demand before merging changes to prod, against concrete
non-functional requirements the user supplies fresh every time. Read
`references/target-isolation.md` and `references/nfr-requirements.md` in
full before doing anything in a target repo — they carry the non-negotiable
safety rules (never the app's real DB, never a remote target without
explicit confirmation) and the requirement-gathering discipline everything
below assumes.

Validated against a real reference app: this skill's FastAPI+SQLAlchemy
profile was built and exercised end-to-end against `car-rental-portal-new`
(register/login, browse/price cars under throughput load, full concurrent
booking-create-view-cancel sessions under session load) — its `k6/`
directory is a live example of everything this file describes, worth
opening directly if a template here is ambiguous.

## Step 0 — Confirm k6 is installed

Follow `references/k6-install.md`. Don't proceed to any other step with a
missing binary — every later step assumes `k6 run` works.

## Step 1 — Is a suite already scaffolded?

Look for `k6/tests/load-test.js` and `k6/.suite-profile.json` at the repo
root.
- **Present** → skip straight to Step 3 (still always re-confirm NFR targets
  and the test DB — Steps 3-4 have no "already answered" shortcut).
- **Absent** → Step 2.

## Step 2 — Bootstrap (first time only, per repo)

1. **Detect the backend** — follow `references/stack-detection.md`. Produces
   a profile (FastAPI+SQLAlchemy / Express / generic) and the concrete
   dir/port/endpoint details. Write `k6/.suite-profile.json` (committed, no
   secrets).
2. **Scaffold `k6/`** from `templates/`:
   - `lib/http-client.js` from `http-client.js.tmpl`, filling in
     `{{BACKEND_TEST_PORT}}` from the profile.
   - `lib/scenarios.js` copied as-is from `scenarios.js.tmpl` (it's fully
     parameterized via `-e` flags — no per-app edits needed unless the
     transaction/metric names below are renamed).
   - `tests/booking-lifecycle.js`, `tests/browse-and-price.js` — **rewrite
     these for the target app's real domain**, this is the part that can't
     be templated generically. Read the actual router/endpoint code (auth
     flow, the app's primary create-a-{thing} transaction, its main
     read/browse path) and adapt the reference templates' shape: one
     function per NFR-relevant scenario, real payload fields, the
     `Trend`/`Rate` custom metrics, unique per-iteration identity data, and
     wide-randomized non-colliding parameters for anything with a
     uniqueness/conflict constraint. Keep the metric names
     (`booking_lifecycle_tat_ms`, `booking_lifecycle` group) in sync with
     whatever `lib/scenarios.js`'s thresholds reference if you rename them.
   - `tests/smoke.js`, `tests/load-test.js` copied as-is (just import the two
     exec functions above — no app-specific content).
   - `.gitignore.fragment` — append its contents to the repo's root
     `.gitignore` (don't overwrite existing entries).
   - `.env.k6.example` copied as-is.
3. Copy `scripts/reset_sql_test_db.py.tmpl` → `k6/scripts/reset_sql_test_db.py`
   (Profile A) or note in the bootstrap report that the app's own
   migrate/seed scripts will be used instead against the test URL (Profile
   B / non-SQLAlchemy backends) — see `references/stack-detection.md`.
4. Copy `scripts/nfr_report.mjs.tmpl` → `k6/scripts/nfr-report.mjs` as-is.
5. No `npm install` needed inside `k6/` — k6 scripts run directly against
   the k6 binary, no bundler/package step.

## Step 3 — Always confirm the five NFR targets (every run, no exceptions)

Follow `references/nfr-requirements.md` exactly. Ask the user directly for
Concurrent Users, TPS, Peak Load, Latency (p95 ms), and TAT (p95 ms) —
plain conversational question, not a guess, not a reused value from a prior
run, not a "typical" default. Do not proceed to Step 4 without all five
answered explicitly for this run. If the user wants to also override the
stage durations (`RAMP_UP`/`HOLD`/`PEAK_HOLD`/`RAMP_DOWN`/`SESSION_DURATION`),
ask if they want non-default values; otherwise use the templates' defaults
and say so in the run report.

## Step 4 — Always confirm the target (every run, no exceptions)

Follow `references/target-isolation.md` exactly — both rules:
1. The load-test database (never the app's real one).
2. The API target (the isolated local backend by default; a remote target
   only with explicit extra confirmation).

Write the accepted DB URL to `k6/.env.k6` (gitignored). Do not proceed to
Step 5 without an explicit, validated answer for both.

## Step 5 — Prepare the test database

Per `references/target-isolation.md` / `stack-detection.md`:
- SQLite: delete the target file if it exists, ensure its parent dir exists
  — the app's own startup path recreates schema + seed data.
- Persistent DB (Profile A/SQLAlchemy): run `k6/scripts/reset_sql_test_db.py
  <test-db-url>` before starting the backend.
- Persistent DB (Profile B/migration-based): run the app's own migrate +
  seed scripts against the test `DATABASE_URL`.

Do this **before** starting the backend process in Step 6.

## Step 6 — Start the isolated backend

Start the backend process (the profile's `backendStartCmd`, port =
`backendTestPort`) with its DB env var overridden to the test URL from Step
4 — as a background process this skill controls directly (k6 has no
Playwright-style `webServer` auto-start; manage the process lifecycle
explicitly: start in background, poll the health path from the profile
until it responds, and remember the process handle so Step 9 can stop it).
Never touch the user's own dev server, running or not.

## Step 7 — Smoke test first

```
cd k6
k6 run -e BASE_URL=http://127.0.0.1:<backendTestPort> tests/smoke.js
```

If this fails, stop — fix the wiring (wrong port, broken auth payload,
scenario bug) before spending real time on the full profile. See
`references/k6-conventions.md`'s "Warm-up before the real run".

## Step 8 — Run the full NFR profile

```
mkdir -p reports   # if not already present
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=reports/dashboard-<unix-timestamp>.html \
k6 run --summary-export=reports/summary-<unix-timestamp>.json \
  -e BASE_URL=http://127.0.0.1:<backendTestPort> \
  -e CONCURRENT_USERS=<value> \
  -e TPS_TARGET=<value> \
  -e PEAK_LOAD=<value> \
  -e LATENCY_P95_MS=<value> \
  -e TAT_P95_MS=<value> \
  tests/load-test.js
```

`K6_WEB_DASHBOARD_EXPORT` writes a self-contained HTML report (charts over
time for request rate, latency, VUs — no external assets, no network
dependency) alongside the JSON summary — see
`references/k6-conventions.md`'s "HTML dashboard export" for why it's only
on this run, not the smoke test. Only on `tests/load-test.js` (never
`tests/smoke.js` — a run under ~60s doesn't have enough data for k6 to
render it and logs a "test run was short, report generation was skipped"
warning instead of a file; the smoke test is deliberately too short for
this and that's fine, it isn't the run being reported on).

Pass `RAMP_UP`/`HOLD`/`PEAK_HOLD`/`RAMP_DOWN`/`SESSION_DURATION` as
additional `-e` flags only if the user asked to override a default in Step
3.

## Step 9 — Tear down

Stop the backend process started in Step 6, regardless of the run's outcome
(pass, fail, or crash mid-run). Never leave an orphaned isolated process
running on the test port.

## Step 10 — Report

Run `node scripts/nfr-report.mjs reports/summary-<ts>.json
<CONCURRENT_USERS> <TPS_TARGET> <PEAK_LOAD> <LATENCY_P95_MS> <TAT_P95_MS>`
and present its five-line scorecard as the headline of the report — target
vs. achieved vs. pass/fail for each NFR, exactly as the user asked for them.
After the scorecard:
- Error rate and check pass-rate (surfaces real correctness regressions
  under load, distinct from NFR pass/fail — see `k6-conventions.md`).
- Booking/conflict-style metric if the scenario tracks one, with a note on
  whether the rate looks like real contention or the randomization window
  being too wide to produce any (see `k6-conventions.md`).
- If the test DB was SQLite and concurrency was non-trivial, the
  SQLite-serialization caveat from `k6-conventions.md` — don't present
  SQLite-limited numbers as the app's real capacity without that caveat.
- Where the raw files are: `k6/reports/summary-<ts>.json`, the HTML
  dashboard at `k6/reports/dashboard-<ts>.html` (open it directly — it's a
  real chart-based report, worth surfacing explicitly rather than only
  mentioning the JSON), and k6's own console output above it.
- If a fresh SQLite file was used, mention it's under `k6/.tmp/` and safe to
  delete any time.

## Extending the suite later

New primary transaction or new hot read path shipped → new exec function in
(or alongside) `tests/booking-lifecycle.js` / `tests/browse-and-price.js`,
following the same unique-data and metric-tagging conventions. This is meant
to grow with the app; don't regenerate the whole `k6/` directory to add one
flow.
