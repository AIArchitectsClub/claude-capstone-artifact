#!/usr/bin/env node
// Static security layer entrypoint.  `npm run security:static`
//
// Runs: the built-in pattern scanner, `npm audit` + lockfile checks, a secret scan, and any
// installed external tools (semgrep / osv-scanner / gitleaks). Merges findings, prints a
// severity-sorted report, writes security/reports/static.json, and exits non-zero if any
// UNSUPPRESSED finding is at or above the gate severity (default: medium; override with
// SECURITY_GATE=high|low|critical).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScan } from "./scan.mjs";
import { runAudit } from "./audit.mjs";
import { runSecretScan } from "./secrets.mjs";
import { runExternal } from "./external.mjs";
import { atLeast, printFindings, sortFindings, summarize, SEVERITY_RANK } from "./report.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const GATE = process.env.SECURITY_GATE || "medium";
const REPORT_DIR = path.join(__dirname, "..", "reports");

console.log(`\n=== static security review — ${ROOT} ===`);
console.log(`gate: fail on any unsuppressed finding >= ${GATE.toUpperCase()}\n`);

const scan = runScan(ROOT);
const audit = runAudit(ROOT);
const secrets = runSecretScan(ROOT);
const external = runExternal(ROOT);

const all = [...scan.findings, ...audit.findings, ...secrets.findings, ...external.findings];

const active = all.filter((f) => !f.suppressed);
const suppressed = all.filter((f) => f.suppressed);
const blocking = active.filter((f) => atLeast(f.severity, GATE));

printFindings(`code scan (${scan.scannedFiles} files)`, scan.findings.filter((f) => !f.suppressed));
printFindings("dependencies", audit.findings);
printFindings("secrets", secrets.findings);
if (external.ran.length) {
  printFindings(`external tools (${external.ran.join(", ")})`, external.findings);
} else {
  console.log("\nexternal tools\n  none installed — `brew install semgrep osv-scanner gitleaks` for deeper SAST/SCA (optional)");
}
if (suppressed.length) printFindings("suppressed (waived inline)", suppressed);

const counts = summarize(all);
console.log(
  `\nsummary: ${counts.critical} critical · ${counts.high} high · ${counts.medium} medium · ` +
    `${counts.low} low · ${counts.info} info · ${counts.suppressed} suppressed`,
);

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(REPORT_DIR, "static.json"),
  JSON.stringify(
    { generatedAt: new Date().toISOString(), root: ROOT, gate: GATE, counts, findings: sortFindings(all), externalToolsRun: external.ran },
    null,
    2,
  ),
);
console.log(`report: security/reports/static.json`);

if (blocking.length) {
  console.log(`\n\x1b[31mFAIL\x1b[0m — ${blocking.length} finding(s) at or above ${GATE.toUpperCase()}:`);
  for (const f of sortFindings(blocking)) console.log(`  ${f.severity.toUpperCase()} [${f.ruleId}] ${f.file}${f.line ? ":" + f.line : ""}`);
  console.log(`\nFix, or waive a verified false positive with:  // security-scan-ignore: <rule-id> -- <reason>`);
  process.exit(1);
}
console.log(`\n\x1b[32mPASS\x1b[0m — no findings at or above ${GATE.toUpperCase()}.`);
