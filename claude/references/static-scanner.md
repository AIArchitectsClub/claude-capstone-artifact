# The static layer (`security/static/`)

`npm run security:static` → `index.mjs`, which runs four sub-scanners, merges findings, prints a
severity-sorted report, writes `security/reports/static.json`, and **exits non-zero if any
unsuppressed finding is at or above the gate severity** (default `medium`; `SECURITY_GATE=high|low|critical`).

## Files

| file | role |
|---|---|
| `rules.mjs` | ~25 pattern/structural rules over `server/**` + `src/**` + root config |
| `scan.mjs` | walks the tree, applies rules, resolves inline suppressions |
| `audit.mjs` | `npm audit --json` threshold gate + lockfile present/committed (A06/A08) |
| `secrets.mjs` | regex secret scan over `git ls-files` blobs + `dist/**` (A02/A05) |
| `external.mjs` | runs `semgrep` / `osv-scanner` / `gitleaks` **iff** on `PATH`; silent skip otherwise |
| `report.mjs` | severity model, suppression matcher, console table |
| `index.mjs` | orchestrator + exit code |

## The rule model

```js
{
  id: "sql-string-concat",
  owasp: "A03:2021-Injection",
  cwe: "CWE-89",
  severity: "critical",           // critical|high|medium|low|info
  message: "...",
  appliesTo: (path) => boolean,    // SERVERISH, CODE+NOT_TESTS, etc.
  find: (content, lines, path, project) => [{ line }],   // project.allText = all source concatenated
}
```

**Precision drives severity.** A rule that can be wrong (heuristic auth-middleware detection,
"SQL fragment has an interpolation") is `info`/`low` — surfaced, never gates. A high-precision
rule (string-concatenated SQL, private-key blob, `eval`) is `high`/`critical` — gates. This keeps
a clean codebase green without a pile of suppressions while still surfacing everything.

Rules are scoped away from `node_modules`, `dist`, `tests/`, `security/`, `*.spec`/`*.test`, and
(for the noisy ones) `**/scripts/**` and the frontend `src/` tree.

## Suppressing a verified false positive

On the flagged line, or up to two lines above it:

```js
// security-scan-ignore: <rule-id> -- <reason, required>
```

The reason after `--` is mandatory (a bare ignore does nothing). Suppressed findings still print,
under "suppressed (waived inline)", with their reason — so a reviewer sees every waiver. Use this
sparingly and only when you have **verified** the finding is safe (e.g. `rejectUnauthorized:false`
scoped to a managed-Postgres pool that has no CA chain).

## `npm audit` gate

`audit.mjs` fails on `high`+`critical` by default (`SECURITY_AUDIT_LEVEL=critical|high|moderate|low`).
It also fails if there is no lockfile, and warns if the lockfile is untracked. `moderate` findings
below the gate are reported as `info`.

## Secret scan

`secrets.mjs` scans the **git-tracked** file set (so gitignored `.env` / `.env.security` are
correctly skipped) plus anything under `dist/`. Patterns: private-key blobs, AWS/GitHub/Slack
tokens, DB URLs with inline credentials, generic `api_key`/`token` literals, long hex assigned to
a `*secret*` var, and a committed `.env` file. A hit inside `dist/` is escalated to `critical`
(it shipped). `.env.example` / `*.sample` / `*.template` only trip on hard blobs.

## External tools (optional, auto-detected)

`external.mjs` shells out only if the binary is on `PATH`:
- `semgrep` → `--config p/owasp-top-ten p/javascript p/nodejs`, JSON parsed into findings
- `osv-scanner` → recursive, JSON → A06 findings
- `gitleaks` → `detect`, JSON → critical secret findings

None installed → one line ("`brew install semgrep osv-scanner gitleaks` for deeper SAST/SCA") and
no failure. The built-in scanner is always the floor.

## Adding a rule

Append to `RULES` in `rules.mjs`. Give it an OWASP + CWE tag, pick severity by how often it will
be wrong, scope it with `appliesTo`, and add a negative-control snippet to the skill's validation
step so you know it bites.
