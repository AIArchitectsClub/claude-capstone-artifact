// Shared helpers for the static security layer: severity model, suppression handling, console
// table, JSON report, and the pass/fail gate.

export const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export function atLeast(sev, floor) {
  return SEVERITY_RANK[sev] >= SEVERITY_RANK[floor];
}

/**
 * A finding is suppressed when the line it points at — or the line above it — carries
 *   // security-scan-ignore: <rule-id> -- <reason>
 * The reason (text after `--`) is required, so suppressions are self-documenting.
 */
export function isSuppressed(finding, fileLines) {
  const idx = (finding.line ?? 1) - 1;
  const candidates = [fileLines[idx], fileLines[idx - 1], fileLines[idx - 2]].filter(Boolean);
  const re = new RegExp(
    `security-scan-ignore:\\s*${finding.ruleId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*--\\s*\\S`,
  );
  return candidates.some((l) => re.test(l));
}

export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      (a.file || "").localeCompare(b.file || "") ||
      (a.line || 0) - (b.line || 0),
  );
}

const COLORS = {
  critical: "\x1b[41m\x1b[97m",
  high: "\x1b[31m",
  medium: "\x1b[33m",
  low: "\x1b[36m",
  info: "\x1b[90m",
  reset: "\x1b[0m",
};

export function printFindings(title, findings) {
  console.log(`\n${title}`);
  if (findings.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const f of sortFindings(findings)) {
    const tag = `${COLORS[f.severity] || ""}${f.severity.toUpperCase().padEnd(8)}${COLORS.reset}`;
    const loc = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : "";
    const meta = [f.owasp, f.cwe].filter(Boolean).join(" ");
    console.log(`  ${tag} [${f.ruleId}] ${f.message}${loc}`);
    if (meta) console.log(`           ${meta}`);
    if (f.suppressed) console.log(`           (suppressed: ${f.suppressionReason || "no reason"})`);
  }
}

export function summarize(all) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, suppressed: 0 };
  for (const f of all) {
    if (f.suppressed) counts.suppressed++;
    else counts[f.severity]++;
  }
  return counts;
}
