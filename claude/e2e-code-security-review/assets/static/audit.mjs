// Dependency / supply-chain checks (OWASP A06 Vulnerable Components, A08 Integrity Failures).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const LEVEL_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

export function runAudit(root = process.cwd()) {
  const findings = [];
  const gateLevel = process.env.SECURITY_AUDIT_LEVEL || "high";

  // 1. npm audit
  let audit;
  try {
    const out = execFileSync("npm", ["audit", "--json"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    audit = JSON.parse(out);
  } catch (err) {
    // `npm audit` exits non-zero when vulns exist — the JSON is still on stdout.
    try {
      audit = JSON.parse(err.stdout || "{}");
    } catch {
      findings.push({
        ruleId: "npm-audit-unavailable", owasp: "A06:2021-Vulnerable-Components", cwe: "CWE-1104",
        severity: "low", message: "npm audit could not run (offline?) — dependency CVEs not checked", file: "package.json",
      });
      audit = null;
    }
  }

  if (audit?.metadata?.vulnerabilities) {
    const v = audit.metadata.vulnerabilities;
    for (const [level, n] of Object.entries(v)) {
      if (!n || level === "total" || level === "info") continue;
      const gate = LEVEL_RANK[level] >= LEVEL_RANK[gateLevel];
      findings.push({
        ruleId: "vulnerable-dependency",
        owasp: "A06:2021-Vulnerable-Components", cwe: "CWE-1035",
        severity: gate ? (level === "moderate" ? "medium" : level) : "info",
        message: `npm audit: ${n} ${level} advisory(ies) in the dependency tree (gate: >= ${gateLevel})`,
        file: "package-lock.json",
      });
    }
  }

  // 2. lockfile must exist and be committed
  const lock = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"].find((f) =>
    fs.existsSync(path.join(root, f)),
  );
  if (!lock) {
    findings.push({
      ruleId: "missing-lockfile", owasp: "A08:2021-Integrity-Failures", cwe: "CWE-1357",
      severity: "high", message: "No dependency lockfile — builds are not reproducible", file: "package.json",
    });
  } else {
    try {
      const tracked = execFileSync("git", ["ls-files", lock], { cwd: root, encoding: "utf8" }).trim();
      if (!tracked) {
        findings.push({
          ruleId: "lockfile-untracked", owasp: "A08:2021-Integrity-Failures", cwe: "CWE-1357",
          severity: "medium", message: `${lock} exists but is not committed to git`, file: lock,
        });
      }
    } catch {
      /* not a git repo — skip */
    }
  }

  return { findings, lockfile: lock, audit: audit?.metadata?.vulnerabilities || null };
}
