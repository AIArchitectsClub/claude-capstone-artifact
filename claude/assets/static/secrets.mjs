// Secret scan over git-tracked files (blob contents) + the built dist/ (OWASP A02 / A05).
// Scanning `git ls-files` means gitignored files like .env / .env.test are correctly NOT read.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PATTERNS = [
  { id: "private-key", cwe: "CWE-798", severity: "critical",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/, desc: "Private key blob" },
  { id: "aws-access-key", cwe: "CWE-798", severity: "critical",
    re: /\bAKIA[0-9A-Z]{16}\b/, desc: "AWS access key id" },
  { id: "aws-secret-key", cwe: "CWE-798", severity: "high",
    re: /\baws_secret_access_key\b\s*[:=]\s*['"]?[A-Za-z0-9/+]{40}['"]?/i, desc: "AWS secret access key" },
  { id: "gh-token", cwe: "CWE-798", severity: "critical",
    re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, desc: "GitHub token" },
  { id: "slack-token", cwe: "CWE-798", severity: "high",
    re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, desc: "Slack token" },
  { id: "db-url-with-password", cwe: "CWE-798", severity: "high",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@]+:[^\s:/@]+@[^\s/]+/, desc: "Database URL with inline credentials" },
  { id: "generic-api-key", cwe: "CWE-798", severity: "medium",
    re: /\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|bearer)\b\s*[:=]\s*['"][A-Za-z0-9_\-.]{20,}['"]/i, desc: "Generic API key / token literal" },
  { id: "high-entropy-secret-assignment", cwe: "CWE-798", severity: "medium",
    re: /\b(secret|token|password)\b\s*[:=]\s*['"][A-Fa-f0-9]{32,}['"]/i, desc: "Long hex value assigned to a secret var" },
];

const PLACEHOLDER =
  /example|changeme|change_me|your[-_ ]|placeholder|dummy|xxxx|<[a-z]|process\.env|import\.meta|redacted|\.\.\.|test['"]?\s*$/i;

const SKIP =
  /(^|\/)(node_modules|\.git)\/|\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|pdf|lock)$|package-lock\.json$/;
const SKIP_SECRET_FILES = /\.(example|sample|template)\b|(^|\/)\.env\.example$|(^|\/)security\//;

function candidateFiles(root) {
  let tracked = [];
  try {
    tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    /* not a git repo */
  }
  const dist = [];
  const distDir = path.join(root, "dist");
  if (fs.existsSync(distDir)) {
    const stack = [distDir];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (/\.(js|mjs|cjs|html|json|css|map)$/.test(e.name)) dist.push(path.relative(root, full));
      }
    }
  }
  return [...new Set([...tracked, ...dist])];
}

export function runSecretScan(root = process.cwd()) {
  const findings = [];
  for (const rel of candidateFiles(root)) {
    if (SKIP.test(rel)) continue;
    let content;
    try {
      content = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (content.length > 2_000_000) continue;
    const lines = content.split("\n");
    const secretFile = SKIP_SECRET_FILES.test(rel);
    lines.forEach((text, i) => {
      for (const p of PATTERNS) {
        if (!p.re.test(text)) continue;
        if (PLACEHOLDER.test(text)) continue;
        if (secretFile && p.severity !== "critical") continue; // .env.example etc: only hard blobs
        findings.push({
          ruleId: `secret:${p.id}`,
          owasp: "A05:2021-Security-Misconfiguration", cwe: p.cwe,
          severity: rel.startsWith("dist/") ? "critical" : p.severity, // secret in the shipped bundle is worst
          message: `${p.desc}${rel.startsWith("dist/") ? " present in the built bundle" : ""}`,
          file: rel, line: i + 1,
        });
      }
    });
  }

  // .env committed to git?
  try {
    const envs = execFileSync("git", ["ls-files", "--", ".env", "*/.env", "**/.env"], {
      cwd: root, encoding: "utf8",
    }).split("\n").filter(Boolean).filter((f) => !/\.example$/.test(f));
    for (const f of envs) {
      findings.push({
        ruleId: "secret:env-file-committed", owasp: "A05:2021-Security-Misconfiguration", cwe: "CWE-538",
        severity: "critical", message: "A .env file is committed to git", file: f,
      });
    }
  } catch {
    /* ignore */
  }

  return { findings };
}
