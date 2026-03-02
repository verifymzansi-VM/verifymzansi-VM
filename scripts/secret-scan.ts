import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

type Rule = {
  name: string;
  pattern: RegExp;
};

const MAX_FILE_SIZE_BYTES = 1_000_000;
const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".lock",
]);

const RULES: Rule[] = [
  {
    name: "Private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: "Stripe live secret",
    pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/g,
  },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    name: "Supabase secret key",
    pattern: /\bsb_secret_[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: "Hardcoded service role key assignment",
    pattern: /\bSUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"'\n]{20,}["']/g,
  },
  {
    name: "PayFast passphrase",
    pattern: /\bPAYFAST_PASSPHRASE\s*[:=]\s*["'][^"'\n]{4,}["']/g,
  },
  {
    name: "Resend API key",
    pattern: /\bre_[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: "Cloudflare API token",
    pattern: /\bcf_[A-Za-z0-9_-]{30,}\b/g,
  },
  {
    name: "Turnstile secret key",
    pattern: /\bTURNSTILE_SECRET_KEY\s*[:=]\s*["'][^"'\n]{10,}["']/g,
  },
  {
    name: "64-char hex string (potential encryption key)",
    pattern: /\b[0-9a-fA-F]{64}\b/g,
  },
];

const gitBin = process.platform === "win32" ? "git.exe" : "git";

function getTrackedFiles(): string[] {
  const result = spawnSync(gitBin, ["ls-files"], { encoding: "utf8", stdio: "pipe" });
  if (result.error) {
    console.error("Failed to run git ls-files:", result.error.message);
    process.exit(1);
  }
  return (result.stdout || "").split(/\r?\n/).filter(Boolean);
}

function shouldSkipFile(path: string): boolean {
  const extension = extname(path).toLowerCase();
  if (SKIP_EXTENSIONS.has(extension)) {
    return true;
  }

  try {
    const stats = statSync(path);
    return stats.size > MAX_FILE_SIZE_BYTES;
  } catch {
    return true;
  }
}

function isAllowedLine(line: string): boolean {
  return line.includes("secret-scan: allow");
}

const findings: string[] = [];

for (const file of getTrackedFiles()) {
  if (shouldSkipFile(file)) {
    continue;
  }

  let content = "";
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);

  RULES.forEach((rule) => {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (isAllowedLine(line)) {
        continue;
      }
      if (rule.pattern.test(line)) {
        findings.push(`${file}:${i + 1} [${rule.name}]`);
      }
      rule.pattern.lastIndex = 0;
    }
  });
}

if (findings.length > 0) {
  console.error("Secret scan failed. Potential secrets found:");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log("Secret scan passed.");
