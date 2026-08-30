# Non-functional requirements — always ask, never assume

This skill exists to verify **five** specific NFR targets, not to run a
generic "some load" smoke test. Every single run — bootstrap or the
thousandth repeat — ask the user for all five before building the load
profile. Never reuse values from a previous run silently, never substitute a
"typical" default, and never proceed with only some of them answered. If the
user gives a range or says "whatever's reasonable," that's still their call
to make explicitly — ask them to pick a concrete number, don't pick one for
them.

Ask for, in this order (plain conversational question is fine — these are
open-ended numeric values, not a multiple-choice decision, so a direct
question in chat works better than forcing preset buttons):

1. **Concurrent Users** — the number of simultaneous active user sessions to
   simulate (drives VU count for the session-based scenario).
2. **TPS (Transactions Per Second)** — the sustained average request rate the
   system must hold up under (drives the arrival-rate scenario's plateau).
3. **Peak Load** — the burst ceiling above sustained TPS the system must
   survive for a short window (e.g. a flash-sale spike). Must be ≥ TPS; if
   the user gives a number equal to TPS, confirm whether they actually want a
   flat profile with no burst, or a distinct peak — don't silently invent a
   burst multiplier for them.
4. **Latency** — the p95 response-time ceiling per API call, in milliseconds.
   Ask whether they also want a p99 figure; if they only give one number,
   treat it as p95 and derive p99 informationally (not as a hard threshold)
   at 1.5x unless they specify otherwise.
5. **TAT (Turn Around Time)** — the p95 ceiling, in milliseconds, for the
   **full end-to-end business transaction** (this app: register → browse →
   price → create booking → view → cancel), not a single HTTP call. This is
   what distinguishes TAT from Latency: Latency bounds one request, TAT
   bounds the whole user journey.

## Mapping onto k6 (what `templates/k6/lib/scenarios.js` does with these)

| NFR | k6 mechanism |
|---|---|
| Concurrent Users | `constant-vus` executor, `vus: <value>`, running the full transaction (`bookingLifecycle`) for the test's total duration — this is what "concurrent" actually means: N sessions in flight at once, not N requests/sec. |
| TPS | `ramping-arrival-rate` executor's plateau stage target, `timeUnit: '1s'`, running the read-heavy scenario (`browseAndPrice`) — arrival-rate executors hold *throughput* constant regardless of how slow individual responses get (unlike `constant-vus`, which throughput-degrades under latency), which is the correct executor for a literal "N requests per second" requirement. |
| Peak Load | A short additional stage in the same `ramping-arrival-rate` scenario, ramping from the TPS plateau up to Peak Load and holding briefly before ramping back down — models a burst, not a new sustained baseline. |
| Latency | `thresholds.http_req_duration: ['p(95)<LATENCY_P95_MS']` — k6's own per-request timing metric, no custom instrumentation needed. |
| TAT | A custom `Trend` metric (`booking_lifecycle_tat_ms`) recording wall-clock time across the whole grouped transaction, thresholded at `p(95)<TAT_P95_MS`. Also mirrored as a `group_duration{group:::booking_lifecycle}` threshold since k6 tracks that automatically too — having both catches the same violation two ways. |

## Reporting back against these five, explicitly

Don't just paste k6's raw summary at the end of a run. Run
`scripts/nfr-report.mjs` (see SKILL.md Step 7) and present its scorecard —
each of the five NFRs on its own line as **target vs. achieved vs.
pass/fail** — before any other commentary. This is the artifact a user
actually wants before merging: "did we meet the numbers we set," not a wall
of k6 metric names.

## Sizing sanity checks worth doing out loud before running

- If Concurrent Users is very high (>500) against a SQLite test DB, warn that
  SQLite serializes writes (see `k6-conventions.md`) and the bottleneck
  observed will be the test database, not the application — recommend a real
  test Postgres/MySQL URL instead so the numbers mean something.
- If Peak Load implies a request rate the local machine running k6 can't
  generate (very rough rule of thumb: thousands of req/s from a single k6
  process on a laptop starts hitting local CPU/network-stack limits before
  the app does), mention k6's distributed/cloud execution exists but is out
  of scope for this skill unless the user asks — don't silently under-deliver
  the requested load without saying so.
