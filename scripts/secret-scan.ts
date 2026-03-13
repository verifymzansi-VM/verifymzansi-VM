import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import {
  SECRET_SCAN_RULES,
  shouldIgnoreSecretFinding,
  type SecretScanRule,
} from "../src/lib/security/secret-scan";

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

  SECRET_SCAN_RULES.forEach((rule: SecretScanRule) => {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (
        shouldIgnoreSecretFinding({
          filePath: file,
          line,
          ruleName: rule.name,
        })
      ) {
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

process.stdout.write("Secret scan passed.\n");
