# k6 scripting conventions for this skill's generated suites

## Two scenarios, run together, mapped to different NFRs

Every generated suite has exactly two `exec` functions, composed under one
`options` object (see `templates/k6/lib/scenarios.js.tmpl`):

- **`bookingLifecycle`** (name it after the target app's real primary
  transaction — "bookingLifecycle" is this reference app's) — the full
  multi-step user journey, run under a `constant-vus` scenario sized to
  **Concurrent Users**. This is what TAT is measured against.
- **`browseAndPrice`** (rename to the target app's read-heavy path) — cheap,
  unauthenticated (or lightly-authenticated) reads, run under a
  `ramping-arrival-rate` scenario targeting **TPS** with a **Peak Load**
  burst stage. This is what the top-line request-rate NFR is measured
  against, decoupled from how many "sessions" that traffic came from.

Don't collapse these into one scenario. `constant-vus` and
`ramping-arrival-rate` answer different questions ("what happens with N
sessions active" vs "can you sustain N requests/sec") and conflating them
makes neither number trustworthy.

## Why `ramping-arrival-rate`, not `ramping-vus`, for the TPS/Peak Load scenario

`ramping-vus` holds *concurrency* constant and lets throughput fall as
latency rises — under real degradation, a `ramping-vus` scenario silently
delivers *less* than the requested TPS instead of surfacing the shortfall.
`ramping-arrival-rate` holds the *request rate itself* constant (opening more
VUs as needed, up to `maxVUs`) — if the app can't keep up, request latency and
the error rate blow past thresholds instead of the executor quietly throttling
for you. That's the correct failure mode for a literal TPS requirement. Size
`preAllocatedVUs`/`maxVUs` generously above the target rate (the template does
`max(concurrentUsers, peakLoad) * 2` / `* 4`) — an arrival-rate scenario that
runs out of VUs to open drops iterations, which reads as a false capacity
ceiling that's actually just a k6 config problem, not the app's.

## Unique data per iteration, always

Every write path (registration email, driver name, booking dates) must be
unique per iteration — never a fixed fixture reused across VUs/iterations.
Reasons: (1) this app's `POST /api/auth/register` 409s on a duplicate email,
which would make every VU after the first fail immediately; (2) fixed booking
dates across many concurrent VUs turns "realistic contention" into "every
single request conflicts with every other," which produces a 409 rate that
reflects the test's own design, not the app's real concurrency behavior.
Use `${__VU}-${__ITER}-${Date.now()}` (or equivalent) for identity fields, and
randomize date offsets across a wide-enough window that natural collisions
stay rare but nonzero (a 409 rate near zero from a genuinely concurrent test
is itself worth a second look — it can mean the randomization window is wide
enough that VUs never contend, which is fine for a pure throughput number but
worth calling out if the user specifically wants contention behavior tested).

## Track conflicts as their own metric, don't let them hide inside "failed"

A `409` from the double-booking guard is the app working correctly — it's not
the same thing as a `500` or a timeout. Tag booking-conflict responses into a
dedicated `Rate` metric (`booking_conflict_rate` in the template) rather than
letting them either count as a check failure (inflates apparent error rate,
makes a NFR run look worse than it is) or silently pass unexamined (hides a
real signal — an unexpectedly high conflict rate at low concurrency would
mean something's wrong with the app's contention logic, not the load profile).

## `checks` vs `thresholds`

`check()` calls are per-request assertions ("did this specific call return
what we expect") and show up in the summary as a pass rate — they catch
*correctness* regressions surfacing under load (a 500 that wouldn't happen at
low concurrency). `thresholds` are the NFR pass/fail gate. Both matter: a
suite that's 100% under threshold but failing half its checks found a real
bug, not a capacity win — call that out explicitly in the report rather than
only reporting threshold status.

## SQLite under concurrent load — expected, not a bug

This reference app's `database.py` opens every SQLite transaction with
`BEGIN IMMEDIATE` specifically to serialize concurrent writes correctly (see
its own inline comment — it's closing a real double-booking race that
`with_for_update()` can't close on SQLite). That means a SQLite-backed load
test will show write-heavy latency growing with concurrency in a way a real
MySQL/Postgres instance won't — this is the test database's ceiling, not the
application code's. Say this explicitly in any report where the chosen test
DB was SQLite and concurrency was non-trivial (roughly >20 concurrent
writers) — don't present SQLite-limited numbers as the app's real capacity.

## HTML dashboard export

k6 (v2.2.0+, and 0.55+ under its old versioning — check `k6 version` if
targeting an older install) has a built-in web dashboard that can also
export a static HTML report: set `K6_WEB_DASHBOARD=true` and
`K6_WEB_DASHBOARD_EXPORT=<path>.html` in the environment around `k6 run`.
Confirmed while validating this skill: the exported file is fully
self-contained (charts render from inlined data, no CDN/network dependency
at view time) and safe to open straight from disk or attach anywhere. It
needs a reasonable amount of run data to have anything to chart — a run
under roughly a minute logs `"the test run was short, report generation was
skipped"` and produces no file instead of an empty/broken one; this is why
`tests/smoke.js` (a few seconds, by design) never gets one and
`tests/load-test.js` (session/ramp durations measured in minutes) always
should. Always request it on the full NFR run (Step 8), never bother wiring
it into the smoke test.

## Reporting: `--summary-export`, not `handleSummary`

Invoke k6 with `--summary-export=<path>.json` rather than a scripted
`handleSummary()` — it gets the JSON dump *and* k6's normal console summary
for free, with no dependency on which convenience helpers a given k6 version
ships. `scripts/nfr-report.mjs` reads that JSON file after the run and prints
the five-line NFR scorecard (see `nfr-requirements.md`).

## Warm-up before the real run

Always run `tests/smoke.js` (1 VU, ~2 iterations of each exec function)
before the full NFR profile, every time — it validates the target is up,
auth works, and the scenario code has no bugs, in seconds, before spending
minutes running a profile that would otherwise fail at second 3 for a
trivial reason (wrong port, expired approach to a payload field, etc.).
