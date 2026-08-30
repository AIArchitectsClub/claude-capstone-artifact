// Walk the source tree and apply security/static/rules.mjs.

import fs from "node:fs";
import path from "node:path";
import { RULES } from "./rules.mjs";
import { isSuppressed } from "./report.mjs";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo",
  "playwright-report", "test-results", "reports",
]);

function walk(dir, root, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walk(full, root, acc);
    } else if (/\.(m?[jt]sx?|cjs|json|ya?ml)$/.test(entry.name)) {
      acc.push(path.relative(root, full));
    }
  }
  return acc;
}

export function runScan(root = process.cwd()) {
  const files = walk(root, root);
  const project = { allText: "" };
  const contents = new Map();
  for (const rel of files) {
    if (/\.(m?[jt]sx?|cjs)$/.test(rel)) {
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      contents.set(rel, text);
      project.allText += "\n" + text;
    }
  }

  const findings = [];
  for (const rule of RULES) {
    for (const [rel, content] of contents) {
      if (!rule.appliesTo(rel)) continue;
      const lines = content.split("\n");
      let raw;
      try {
        raw = rule.find(content, lines, rel, project) || [];
      } catch (err) {
        console.warn(`  rule ${rule.id} threw on ${rel}: ${err.message}`);
        continue;
      }
      for (const hit of raw) {
        const finding = {
          ruleId: rule.id,
          owasp: rule.owasp,
          cwe: rule.cwe,
          severity: rule.severity,
          message: rule.message,
          file: rel,
          line: hit.line,
        };
        const supp = isSuppressed(finding, lines);
        if (supp) {
          const around = [lines[(hit.line ?? 1) - 1], lines[(hit.line ?? 1) - 2], lines[(hit.line ?? 1) - 3]]
            .filter(Boolean)
            .find((l) => /security-scan-ignore:/.test(l)) || "";
          finding.suppressed = true;
          finding.suppressionReason = (around.match(/security-scan-ignore:\s*\S+\s*--\s*(.+?)\s*$/) || [])[1]?.trim();
        }
        findings.push(finding);
      }
    }
  }
  return { findings, scannedFiles: contents.size };
}
