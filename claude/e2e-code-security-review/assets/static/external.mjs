// Opportunistically run external SAST/secret/SCA tools IF they are installed. Never required —
// if none are present the static layer still runs on the built-in scanner alone.

import { execFileSync, execSync } from "node:child_process";

function has(bin) {
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function tryRun(bin, args, parse) {
  try {
    const out = execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    return parse(out);
  } catch (err) {
    try {
      return parse(err.stdout || "");
    } catch {
      return [];
    }
  }
}

export function runExternal(root = process.cwd()) {
  const findings = [];
  const ran = [];

  if (has("semgrep")) {
    ran.push("semgrep");
    findings.push(
      ...tryRun(
        "semgrep",
        ["--quiet", "--json", "--config", "p/owasp-top-ten", "--config", "p/javascript", "--config", "p/nodejs", root],
        (out) => {
          const j = JSON.parse(out || "{}");
          return (j.results || []).map((r) => ({
            ruleId: `semgrep:${r.check_id.split(".").pop()}`,
            owasp: (r.extra?.metadata?.owasp || [])[0] || "OWASP",
            cwe: (r.extra?.metadata?.cwe || [])[0] || null,
            severity: ({ ERROR: "high", WARNING: "medium", INFO: "low" })[r.extra?.severity] || "medium",
            message: r.extra?.message?.split("\n")[0] || r.check_id,
            file: r.path?.replace(root + "/", ""),
            line: r.start?.line,
          }));
        },
      ),
    );
  }

  if (has("osv-scanner")) {
    ran.push("osv-scanner");
    findings.push(
      ...tryRun("osv-scanner", ["--format", "json", "-r", root], (out) => {
        const j = JSON.parse(out || "{}");
        return (j.results || []).flatMap((res) =>
          (res.packages || []).flatMap((p) =>
            (p.vulnerabilities || []).map((v) => ({
              ruleId: `osv:${v.id}`, owasp: "A06:2021-Vulnerable-Components", cwe: "CWE-1035",
              severity: "high", message: `${p.package?.name}: ${v.summary || v.id}`,
              file: res.source?.path?.replace(root + "/", ""),
            })),
          ),
        );
      }),
    );
  }

  if (has("gitleaks")) {
    ran.push("gitleaks");
    findings.push(
      ...tryRun("gitleaks", ["detect", "--no-banner", "--redact", "-r", "/dev/stdout", "-f", "json", "-s", root], (out) => {
        const j = JSON.parse(out || "[]");
        return (Array.isArray(j) ? j : []).map((g) => ({
          ruleId: `gitleaks:${g.RuleID}`, owasp: "A05:2021-Security-Misconfiguration", cwe: "CWE-798",
          severity: "critical", message: `Secret: ${g.Description}`, file: g.File, line: g.StartLine,
        }));
      }),
    );
  }

  return { findings, ran };
}
