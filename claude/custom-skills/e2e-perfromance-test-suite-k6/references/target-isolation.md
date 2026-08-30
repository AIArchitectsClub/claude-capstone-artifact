# Target isolation — the two non-negotiable rules

A load test is not a UI test: it deliberately generates high-volume,
high-concurrency write traffic. Getting isolation wrong here is worse than in
a functional suite — it can corrupt real data, exhaust a shared database's
connections, or hammer a production API. Treat both rules below as blockers,
every single run, not just at first bootstrap.

## Rule 1 — never the application's real database

Same discipline as this skill's UI-testing sibling
(`e2e-test-suite-ui-playwright`'s `db-isolation.md`), repeated here because it
matters even more under load:

1. Locate the app's real DB config (e.g. `<backendDir>/.env`'s `DATABASE_URL`,
   or whatever `dbEnvVar` stack-detection recorded). Read the value — this is
   the **denylist entry** for this run. If it can't be found, treat the
   denylist as unknown and be extra conservative about accepting a URL that
   looks like it could be the same host.
2. Ask (`AskUserQuestion`, **every run, no exceptions, no cached default**):
   - **"Fresh local SQLite file (recommended for quick validation runs)"** —
     generate `k6/.tmp/load-test-<unix-timestamp>.db`. Note: a file-based
     SQLite DB will itself become the bottleneck under real concurrent load
     (see `k6-conventions.md`'s note on `BEGIN IMMEDIATE` serializing writes)
     — fine for smoke/dry runs, not representative for a real capacity test.
   - **"Use a specific test database URL"** — user pastes a connection
     string for a database provisioned specifically for load testing (ideally
     sized/configured like the real one, so results are meaningful).
   - If `k6/.env.k6` already holds a URL from a previous run, offer it as a
     third option — **"Reuse last load-test DB (<redacted host/db>)"** — but
     this is still a choice the user actively makes each run, never an
     implicit default.
3. **Validate the answer against the denylist** before doing anything else:
   - Exact string match → reject, explain why, ask again.
   - Same host **and** same database/schema name (parse both URLs, compare
     host + path, ignore credentials) → reject even if scheme/user differs.
   - A SQLite path resolving to the same file as the app's configured SQLite
     path → reject.
   - Genuinely unsure whether two URLs point at the same place (e.g. a
     pooler/proxy hostname) → say so and ask the user to confirm, never guess.
4. Only after an accepted answer: write it to `k6/.env.k6` (gitignored, never
   committed — verify `.gitignore` covers it as part of bootstrap).

## Rule 2 — never a remote or production API target, by default

k6 sends real HTTP traffic at whatever `BASE_URL` you give it, at whatever
concurrency the NFR targets specify. Pointed at the wrong host, this is
functionally a self-inflicted denial-of-service.

- **Default and recommended target**: the isolated backend process this skill
  starts itself, on a dedicated test port, pointed at the test database from
  Rule 1. Nothing outside this skill's own process tree ever receives load.
- If the user explicitly wants to load-test a **deployed** environment (a
  staging/pre-prod URL), that's a legitimate ask this skill supports — but:
  - Confirm explicitly which URL, and confirm out loud that it is **not**
    production (cross-check against anything resembling the app's known prod
    domain — Render URL in `render.yaml`, a custom domain in docs, etc.).
  - Confirm the target environment's owner expects load traffic right now —
    a staging DB shared with other engineers can suffer the same corruption
    problem as Rule 1 even if the URL itself is "just staging."
  - Never combine a remote target with the locally-computed NFR values
    without re-confirming the target can actually take that load — ask
    whether to start at a much lower ramp first (e.g. 10% of the requested
    peak) as a sanity check before committing to the full profile.
- Never accept a bare guess at a prod-sounding hostname as the target without
  this explicit confirmation, even if the user's phrasing sounds casual
  ("just hit the real API real quick").

## After a run

Leave the test database as-is so a failing/anomalous run can be inspected
(e.g. checking for lock contention, orphaned bookings). The next run's
"prepare" step resets it anyway. If the chosen answer was a fresh SQLite file,
mention in the report that it's under `k6/.tmp/` (gitignored) and safe to
delete any time.
