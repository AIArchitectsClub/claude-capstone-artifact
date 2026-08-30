// Static security rules. Each rule:
//   { id, owasp, cwe, severity, message, appliesTo(path)->bool, find(content, lines, path)->[{line}] }
//
// Precision guides severity: rules that can be wrong are `info`/`low` (surfaced, non-gating);
// high-precision rules are `high`/`critical` (gating). The default gate is `medium` — see index.mjs.
// Any finding can be waived inline with:  // security-scan-ignore: <rule-id> -- <reason>

const CODE = /\.(m?[jt]sx?|cjs)$/;
const NOT_TESTS = (p) =>
  !/(^|\/)(node_modules|dist|build|coverage|\.git|security|tests?|__tests__|e2e|playwright-report)(\/|$)/.test(p) &&
  !/\.(test|spec)\.[jt]sx?$/.test(p);
const SERVERISH = (p) => CODE.test(p) && NOT_TESTS(p) && !/(^|\/)(src|client|app|components|pages)\//.test(p);

/** Return 1-based line numbers where `re` matches, scanning line by line. */
function hits(lines, re) {
  const out = [];
  lines.forEach((text, i) => {
    // reset lastIndex for global regexes
    re.lastIndex = 0;
    if (re.test(text)) out.push({ line: i + 1 });
  });
  return out;
}

/** Multiline-aware: match across the whole file, map match index -> line number. */
function hitsMultiline(content, lines, re) {
  const out = [];
  let m;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = g.exec(content))) {
    const line = content.slice(0, m.index).split("\n").length;
    out.push({ line });
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}

const PLACEHOLDER_SECRET =
  /(process\.env|import\.meta\.env|""|''|``|changeme|change_me|example|your[-_]|xxx+|<[a-z]|placeholder|dummy|todo|redacted|\*{3,})/i;

export const RULES = [
  {
    id: "sql-string-concat",
    owasp: "A03:2021-Injection", cwe: "CWE-89", severity: "critical",
    message: "SQL string built with string concatenation — use parameterized queries ($1, ?)",
    appliesTo: SERVERISH,
    find: (c, l) =>
      // a .query()/.execute()/.raw() call whose argument list splices a string literal with `+`
      hitsMultiline(
        c, l,
        /\.(query|execute|exec|raw|prepare)\s*\(\s*[^;]{0,400}?['"`][^;]{0,200}?\+[^;]{0,200}?['"`]/,
      ),
  },
  {
    id: "sql-template-interpolation-user-input",
    owasp: "A03:2021-Injection", cwe: "CWE-89", severity: "critical",
    message: "SQL template literal interpolates a request value directly",
    appliesTo: SERVERISH,
    find: (c, l) =>
      hitsMultiline(
        c, l,
        /\.(query|execute|raw)\s*\(\s*`[^`]*\$\{[^}]*\b(req|ctx|context|input|body|params?)\b[^}]*\}[^`]*`/,
      ),
  },
  {
    id: "dynamic-sql-fragment",
    owasp: "A03:2021-Injection", cwe: "CWE-89", severity: "info",
    message: "SQL string contains an interpolation — verify only static identifiers, never values, are inserted",
    appliesTo: SERVERISH,
    find: (c, l) =>
      hitsMultiline(c, l, /\.(query|execute|raw)\s*\(\s*`[^`]*\$\{(?!\$)/),
  },
  {
    id: "command-injection",
    owasp: "A03:2021-Injection", cwe: "CWE-78", severity: "critical",
    message: "Shell/child_process call with dynamic input or shell:true",
    appliesTo: SERVERISH,
    find: (c, l) => [
      ...hitsMultiline(c, l, /\b(exec|execSync)\s*\(\s*[`'"][^`'"]*\$\{|\b(exec|execSync)\s*\(\s*[^,)]*\+/),
      ...hitsMultiline(c, l, /\bspawn(Sync)?\s*\([^)]*shell\s*:\s*true/),
    ],
  },
  {
    id: "eval-usage",
    owasp: "A03:2021-Injection", cwe: "CWE-95", severity: "high",
    message: "Dynamic code execution (eval / new Function / string setTimeout)",
    appliesTo: (p) => CODE.test(p) && NOT_TESTS(p),
    find: (c, l) => hits(l, /(^|[^.\w])eval\s*\(|new\s+Function\s*\(|set(Timeout|Interval)\s*\(\s*['"]/),
  },
  {
    id: "raw-html-sink",
    owasp: "A03:2021-Injection", cwe: "CWE-79", severity: "high",
    message: "Unsanitized HTML sink (dangerouslySetInnerHTML / innerHTML / insertAdjacentHTML)",
    appliesTo: (p) => CODE.test(p) && NOT_TESTS(p),
    find: (c, l) =>
      hits(l, /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|\bv-html\b|\)\.html\s*\(/),
  },
  {
    id: "weak-random-security",
    owasp: "A02:2021-Cryptographic-Failures", cwe: "CWE-338", severity: "medium",
    message: "Math.random() near a security value (token/secret/otp/session/salt) — use crypto.randomBytes / randomUUID",
    appliesTo: (p) => CODE.test(p) && NOT_TESTS(p),
    find: (c, l) => {
      const out = [];
      l.forEach((text, i) => {
        if (!/Math\.random\s*\(/.test(text)) return;
        const ctx = l.slice(Math.max(0, i - 2), i + 3).join("\n");
        if (/\b(token|secret|nonce|otp|session|password|passwd|salt|api[_-]?key|csrf|verif)/i.test(ctx))
          out.push({ line: i + 1 });
      });
      return out;
    },
  },
  {
    id: "private-key-blob",
    owasp: "A02:2021-Cryptographic-Failures", cwe: "CWE-798", severity: "critical",
    message: "Private key material committed in source",
    appliesTo: (p) => !/(node_modules|\.git)\//.test(p),
    find: (c, l) => hits(l, /-----BEGIN (RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/),
  },
  {
    id: "hardcoded-secret",
    owasp: "A05:2021-Security-Misconfiguration", cwe: "CWE-798", severity: "high",
    message: "Secret assigned a literal value in source",
    appliesTo: (p) =>
      CODE.test(p) && NOT_TESTS(p) && !/\.(example|sample|template|dist)\b/.test(p),
    find: (c, l) => {
      const out = [];
      const re =
        /\b(secret|password|passwd|passphrase|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|auth[_-]?token)\b\s*[:=]\s*(['"`])([^'"`]{8,})\2/i;
      l.forEach((text, i) => {
        const m = text.match(re);
        if (m && !PLACEHOLDER_SECRET.test(m[3]) && !PLACEHOLDER_SECRET.test(text)) out.push({ line: i + 1 });
      });
      return out;
    },
  },
  {
    id: "tls-reject-unauthorized",
    owasp: "A02:2021-Cryptographic-Failures", cwe: "CWE-295", severity: "medium",
    message: "TLS certificate verification disabled — a MITM can read/alter this connection",
    appliesTo: (p) => CODE.test(p) && NOT_TESTS(p),
    find: (c, l) =>
      hits(l, /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|checkServerIdentity\s*:\s*\(\s*\)\s*=>/),
  },
  {
    id: "permissive-cors",
    owasp: "A05:2021-Security-Misconfiguration", cwe: "CWE-942", severity: "high",
    message: "CORS reflects any origin (origin:true / '*' with credentials, or Origin echoed back)",
    appliesTo: SERVERISH,
    find: (c, l) => [
      ...hitsMultiline(c, l, /cors\s*\(\s*\{[^}]*origin\s*:\s*(true|['"]\*['"])[^}]*\}/),
      ...hitsMultiline(c, l, /origin\s*:\s*true[\s\S]{0,120}credentials\s*:\s*true|credentials\s*:\s*true[\s\S]{0,120}origin\s*:\s*true/),
      ...hits(l, /["']Access-Control-Allow-Origin["']\s*,\s*(req\.headers\.origin|req\.get\(['"]origin)/i),
    ],
  },
  {
    id: "cors-enabled",
    owasp: "A05:2021-Security-Misconfiguration", cwe: "CWE-942", severity: "info",
    message: "CORS middleware in use — confirm the allow-list is explicit and credentials handling is intentional",
    appliesTo: SERVERISH,
    find: (c, l) => hits(l, /require\(['"]cors['"]\)|from\s+['"]cors['"]|\bcors\s*\(/),
  },
  {
    id: "router-write-without-auth",
    owasp: "A01:2021-Broken-Access-Control", cwe: "CWE-862", severity: "medium",
    message: "Router defines PUT/PATCH/DELETE handlers but mounts no auth middleware",
    appliesTo: SERVERISH,
    find: (c, l) => {
      if (!/\bRouter\s*\(\)/.test(c)) return [];
      if (!/\.(put|patch|delete)\s*\(/.test(c)) return [];
      if (/\b(requireAuth|requireSession|requireUser|isAuthenticated|ensureAuth|authenticate|authGuard|protect|verifyToken)\b/.test(c))
        return [];
      return hits(l, /\.(put|patch|delete)\s*\(/);
    },
  },
  {
    id: "route-post-without-auth",
    owasp: "A01:2021-Broken-Access-Control", cwe: "CWE-862", severity: "info",
    message: "Router defines POST handlers with no auth middleware — fine for public endpoints (login/search/contact), verify",
    appliesTo: SERVERISH,
    find: (c, l) => {
      if (!/\bRouter\s*\(\)/.test(c) || !/\.post\s*\(/.test(c)) return [];
      if (/\b(requireAuth|requireSession|requireUser|isAuthenticated|ensureAuth|authenticate|authGuard|protect)\b/.test(c))
        return [];
      return hits(l, /\.post\s*\(/).slice(0, 1);
    },
  },
  {
    id: "jwt-weak-verification",
    owasp: "A02:2021-Cryptographic-Failures", cwe: "CWE-347", severity: "high",
    message: "JWT verified without pinning algorithms, or 'none' algorithm allowed",
    appliesTo: SERVERISH,
    find: (c, l) => [
      ...hits(l, /algorithms?\s*:\s*\[?\s*['"]none['"]/i),
      ...hitsMultiline(c, l, /jwt\.verify\s*\([^)]*\)(?![\s\S]{0,80}algorithms)/),
    ],
  },
  {
    id: "sensitive-data-logged",
    owasp: "A09:2021-Logging-Failures", cwe: "CWE-532", severity: "low",
    message: "Log statement may write secrets/PII (req.body, headers, password, token)",
    appliesTo: SERVERISH,
    find: (c, l) =>
      hits(l, /console\.(log|info|debug|warn|error)\s*\([^)]*(req\.body|req\.headers|\bpassword\b|\btoken\b|authorization|set-cookie)/i),
  },
  {
    id: "open-redirect",
    owasp: "A01:2021-Broken-Access-Control", cwe: "CWE-601", severity: "high",
    message: "Redirect target derived from request input",
    appliesTo: SERVERISH,
    find: (c, l) => hits(l, /res\.redirect\s*\([^)]*req\.(query|body|params|headers)/),
  },
  {
    id: "insecure-cookie",
    owasp: "A05:2021-Security-Misconfiguration", cwe: "CWE-614", severity: "medium",
    message: "Cookie set without httpOnly / secure / sameSite",
    appliesTo: SERVERISH,
    find: (c, l) =>
      hitsMultiline(c, l, /res\.cookie\s*\(\s*[^,]+,\s*[^,]+,\s*\{(?:(?!httpOnly)(?!sameSite)(?!secure)[\s\S]){0,200}\}\s*\)/),
  },
  {
    id: "path-traversal",
    owasp: "A01:2021-Broken-Access-Control", cwe: "CWE-22", severity: "high",
    message: "Filesystem path built from request input without basename/resolve containment",
    appliesTo: SERVERISH,
    find: (c, l) => {
      const out = [];
      l.forEach((text, i) => {
        if (!/(sendFile|readFile|readFileSync|createReadStream|unlink|writeFile|rmdir|rm)\s*\(/.test(text)) return;
        const ctx = l.slice(i, i + 3).join("\n");
        if (/req\.(params|query|body)/.test(ctx) && !/path\.(basename|resolve)/.test(ctx)) out.push({ line: i + 1 });
      });
      return out;
    },
  },
  {
    id: "mass-assignment",
    owasp: "A01:2021-Broken-Access-Control", cwe: "CWE-915", severity: "medium",
    message: "Whole request body spread into a model/DB write — allow-list the fields instead",
    appliesTo: SERVERISH,
    find: (c, l) =>
      hits(l, /Object\.assign\s*\([^,]+,\s*req\.body|\.\.\.req\.body|new\s+[A-Z]\w*\s*\(\s*req\.body\s*\)|\.(create|update|insert|save)\s*\(\s*req\.body\s*\)/),
  },
  {
    id: "error-details-to-client",
    owasp: "A05:2021-Security-Misconfiguration", cwe: "CWE-209", severity: "high",
    message: "Error stack/message sent to the client",
    appliesTo: SERVERISH,
    find: (c, l) =>
      hits(l, /res\.(status\([0-9]+\)\.)?(json|send)\s*\([^)]*\b(err|error|e)\.(stack|message)\b|res\.(json|send)\s*\(\s*(err|error)\s*\)/),
  },
  {
    id: "outbound-request-user-url",
    owasp: "A10:2021-SSRF", cwe: "CWE-918", severity: "high",
    message: "Outbound HTTP request to a URL derived from request input (SSRF)",
    appliesTo: SERVERISH,
    find: (c, l) =>
      hits(l, /\b(fetch|axios|got|undici|request|superagent)\b[^;\n]*\breq\.(query|body|params)|https?\.(get|request)\s*\([^)]*req\.(query|body|params)/),
  },
  {
    id: "express-no-helmet",
    owasp: "A05:2021-Security-Misconfiguration", cwe: "CWE-693", severity: "medium",
    message: "Express app with no helmet() and no manual security-header middleware",
    appliesTo: SERVERISH,
    find: (c, l) => {
      if (!/\bexpress\s*\(\s*\)/.test(c)) return [];
      if (/helmet|X-Content-Type-Options|Content-Security-Policy|Strict-Transport-Security/i.test(c)) return [];
      return hits(l, /\bexpress\s*\(\s*\)/);
    },
  },
  {
    id: "express-x-powered-by",
    owasp: "A05:2021-Security-Misconfiguration", cwe: "CWE-200", severity: "low",
    message: "Express advertises itself via X-Powered-By (no disable('x-powered-by') and no helmet)",
    appliesTo: SERVERISH,
    find: (c, l) => {
      if (!/\bexpress\s*\(\s*\)/.test(c)) return [];
      if (/disable\s*\(\s*['"]x-powered-by['"]\s*\)|helmet/i.test(c)) return [];
      return hits(l, /\bexpress\s*\(\s*\)/);
    },
  },
  {
    id: "missing-rate-limit",
    owasp: "A07:2021-Auth-Failures", cwe: "CWE-307", severity: "low",
    message: "Auth/login code present but no rate limiting configured anywhere in the project",
    appliesTo: SERVERISH,
    projectWide: true,
    find: (c, l, path, project) => {
      if (!/(sign-?in|login|authenticate|password)/i.test(project.allText)) return [];
      if (/(express-rate-limit|rate-limiter-flexible|rateLimit|RateLimiter|\bthrottle\b|slow-down|bottleneck)/i.test(project.allText))
        return [];
      return /\bexpress\s*\(\s*\)/.test(c) ? hits(l, /\bexpress\s*\(\s*\)/) : [];
    },
  },
];
