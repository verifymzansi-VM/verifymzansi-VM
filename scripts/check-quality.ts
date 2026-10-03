import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as prettier from "prettier";
import { execute } from "./lib/audit-runtime";
import {
  qualityFingerprint,
  qualityRegressions,
  type QualityFinding,
  type QualityBaseline,
} from "./lib/quality-policy";
export async function collectQuality(mode: "lint" | "format"): Promise<QualityFinding[]> {
  const findings: QualityFinding[] = [];
  if (mode === "lint") {
    const result = await execute(
      process.execPath,
      ["node_modules/eslint/bin/eslint.js", "src", "scripts", "workers", "--format=json"],
      600_000
    );
    if (!["PASS", "FAIL"].includes(result.status))
      throw new Error(`ESLint incomplete: ${result.output}`);
    const rows = JSON.parse(result.output);
    if (!Array.isArray(rows) || !rows.length) throw new Error("Empty/invalid ESLint report");
    for (const row of rows)
      for (const message of row.messages) {
        const file = path.relative(process.cwd(), row.filePath).replace(/\\/g, "/");
        const rule = message.ruleId || "parser";
        findings.push({
          file,
          rule,
          message: message.message,
          security:
            rule.startsWith("security/") || /unsafe|vulnerab|injection/i.test(message.message),
          error: message.severity === 2,
          fingerprint: qualityFingerprint(file, rule, message.message),
        });
      }
  } else {
    const enumeration = spawnSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }
    );
    if (enumeration.status !== 0) throw new Error("Cannot enumerate format scope");
    const files = [...new Set(enumeration.stdout.split("\0"))].filter(
      (file) =>
        /^(src|scripts|workers)\/.*\.(ts|tsx|js|mjs|cjs|json|css)$/.test(file) ||
        /^[^/]+\.(js|mjs|cjs|json|md)$/.test(file) ||
        /^\.agents\/skills\/(code-review-security-auditor|release-readiness-synthesizer|payment-auditor|kyc-auditor)\/SKILL\.md$/.test(
          file
        ) ||
        /^docs\/(audit-tools|ozow-integration-guide|kyc-audit-guide|encryption-recovery|audit-findings-2026-10-03|branch-protection)\.md$/.test(
          file
        )
    );
    if (!files.length) throw new Error("Empty format scan scope");
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const config = await prettier.resolveConfig(file);
      if (!(await prettier.check(source, { ...config, filepath: file })))
        findings.push({
          file,
          rule: "prettier",
          message: "Format differs",
          security: false,
          error: false,
          fingerprint: qualityFingerprint(file, "prettier", source.replace(/\r\n/g, "\n")),
        });
    }
  }
  return findings;
}
async function main() {
  const mode = process.argv[2];
  if (
    !["lint", "format"].includes(mode) ||
    process.argv.slice(3).some((arg) => !["--", "--max-warnings=0"].includes(arg)) ||
    (mode === "format" && process.argv.includes("--max-warnings=0"))
  )
    throw new Error("Usage: check-quality.ts <lint|format>");
  const findings = await collectQuality(mode as "lint" | "format");
  const baseline = JSON.parse(
    await readFile(`scripts/audit-baselines/${mode}.json`, "utf8")
  ) as QualityBaseline;
  const regressions = qualityRegressions(findings, baseline);
  await mkdir("tmp/quality", { recursive: true });
  await writeFile(
    `tmp/quality/${mode}.json`,
    JSON.stringify(
      { schemaVersion: 1, findings, regressions, baseline: `scripts/audit-baselines/${mode}.json` },
      null,
      2
    )
  );
  for (const finding of regressions)
    process.stderr.write(`${finding.file} [${finding.rule}]: ${finding.message}\n`);
  if (regressions.length || (findings.length && process.argv.includes("--max-warnings=0")))
    process.exitCode = 1;
  else if (findings.length)
    process.stdout.write(
      `WARN: ${findings.length} existing non-security ${mode} findings match reviewed baseline; no new regressions\n`
    );
  else process.stdout.write(`${mode} passed\n`);
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/check-quality.ts"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
