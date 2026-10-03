import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  execute,
  redact,
  parseArguments,
  assessment,
  pnpmInvocation,
  runAudit,
  type CheckResult,
} from "./lib/audit-runtime";
import { CHECKS, selectChecks } from "./lib/check-registry";
import { validateLicenseReport } from "./lib/license-policy";
import { validateDuplication } from "./lib/duplication-policy";
import { scanFile } from "./lib/secret-scan-files";
import { dependencyAuditVerdict } from "./dependency-audit-policy";
import { qualityRegressions } from "./lib/quality-policy";
import { socialWatermarks } from "./lib/social-watermarks";
import sharp from "sharp";
import { sanitizeCloudflareEnvModule } from "./lib/cloudflare-env-policy";
import { parseSupabaseStatus } from "./lib/supabase-status";
test("isolated database status accepts CLI notices and rejects malformed or remote targets", () => {
  const status = {
    API_URL: "http://127.0.0.1:56421",
    ANON_KEY: "fixture-anon",
    SERVICE_ROLE_KEY: "fixture-service",
    note: 'quoted } brace and escaped "quote"',
  };
  const json = JSON.stringify(status, null, 2);
  assert.deepEqual(
    parseSupabaseStatus(
      `Stopped services: [studio]\n${json}\nA new version is available {notice}\n`
    ),
    status
  );
  assert.deepEqual(parseSupabaseStatus(json), status);
  for (const bad of [
    "",
    "{}",
    json.slice(0, -1),
    '{"API_URL": invalid}',
    JSON.stringify({ ...status, SERVICE_ROLE_KEY: "" }),
    ...[
      "https://remote.example",
      "http://localhost:54321",
      "http://localhost:56421/path",
      "http://user:password@localhost:56421",
    ].map((API_URL) => JSON.stringify({ ...status, API_URL })),
  ])
    assert.throws(() => parseSupabaseStatus(bad));
});
test("Cloudflare fallback exports retain public settings and cannot bundle private credentials", () => {
  const env = {
    NEXT_PUBLIC_APP_URL: "https://fixture.example",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-public",
    KYC_ENCRYPTION_KEY: "fixture-private",
    HMAC_SECRET: "fixture-private",
    NEXT_PUBLIC_SERVICE_ROLE_KEY: "fixture-private",
    OZOW_ENV: "production",
  };
  const input = ["production", "development", "test"]
    .map((mode) => `export const ${mode} = ${JSON.stringify(env)};`)
    .join("\n");
  const result = sanitizeCloudflareEnvModule(input);
  assert(!result.source.includes("fixture-private"));
  assert(result.source.includes("fixture-public"));
  assert.deepEqual(result.removed, [
    "HMAC_SECRET",
    "KYC_ENCRYPTION_KEY",
    "NEXT_PUBLIC_SERVICE_ROLE_KEY",
    "OZOW_ENV",
  ]);
  for (const malformed of [
    "",
    input + "\n" + input,
    input.replace('"production"', "null"),
    input.replace('"fixture-private"', "7"),
    "export const production = {};",
  ])
    assert.throws(() => sanitizeCloudflareEnvModule(malformed));
});
const row = (status: CheckResult["status"], required = true): CheckResult => ({
  id: "fixture",
  name: "fixture",
  command: "fixture",
  category: "repo_runtime",
  optional: false,
  required,
  status,
  exitCode: null,
  executed: false,
  durationMs: 0,
  warnings: [],
  findings: [],
  evidence: [],
});
test("watermark generation preserves sizes, transparent containment and named variants", async () => {
  const icon = await sharp({
    create: {
      width: 256,
      height: 128,
      channels: 4,
      background: { r: 20, g: 100, b: 150, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const images = await socialWatermarks(icon);
  assert.equal(images.size, 5);
  for (const [name, image] of images) {
    const size = name.endsWith("512.png") ? 512 : 150;
    const meta = await sharp(image).metadata();
    assert.equal(meta.width, size);
    assert.equal(meta.height, size);
    assert.equal(meta.format, "png");
    const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    assert.equal(data[3], 0);
    assert.equal(data[(Math.floor(size / 2) * size + Math.floor(size / 2)) * 4 + 3], 255);
  }
  assert.deepEqual(
    images.get("youtube-watermark-shield-150-badge.png"),
    images.get("youtube-watermark-shield-150.png")
  );
});
test("strict flags, unique registry and mandatory domain/release lanes", () => {
  for (const arg of [
    "--typo",
    "--checks=",
    "--checks=unit,unit",
    "--checks=unknown",
    "--timeout-ms=NaN",
    "--timeout-ms=0",
  ])
    assert.throws(() => parseArguments([arg]));
  assert.equal(new Set(CHECKS.map((c) => c.id)).size, CHECKS.length);
  const release = selectChecks("release");
  assert(release.find((c) => c.id === "unit"));
  assert(!release.find((c) => c.id === "payment-unit")); // Already covered once by full unit lane.
  for (const id of [
    "unit",
    "db-payments",
    "db-kyc",
    "browser",
    "contracts",
    "isolated-db",
    "kyc-auth-browser",
  ])
    assert.equal(release.find((c) => c.id === id)?.optional, undefined);
  assert(selectChecks("payments").some((c) => c.id === "payment-unit"));
  assert(selectChecks("kyc").some((c) => c.id === "kyc-unit"));
  assert.equal(pnpmInvocation(["lint"], "linux")[0], "pnpm");
  assert.deepEqual(pnpmInvocation(["lint"], "win32")[1], ["/d", "/s", "/c", "pnpm", "lint"]);
});
test("required incomplete checks cannot pass; advisory warnings and dry runs remain visible", () => {
  for (const status of ["SKIPPED", "UNAVAILABLE", "TIMED_OUT"] as const)
    assert.equal(assessment([row(status)], false), "INCOMPLETE");
  assert.equal(assessment([row("FAIL")], false), "FAIL");
  assert.equal(assessment([row("WARN", false)], false), "WARN");
  assert.equal(assessment([row("PASS")], true), "DRY_RUN");
});
test("missing executable, timeouts, redaction and exit-status handling", async () => {
  assert.equal(
    (await execute("nonexistent-audit-executable-0001", [], 1000)).status,
    "UNAVAILABLE"
  );
  assert.equal(
    (await execute(process.execPath, ["-e", "setInterval(()=>{},1000)"], 50)).status,
    "TIMED_OUT"
  );
  assert.equal((await execute(process.execPath, ["-e", "process.exit(1)"], 30_000)).status, "FAIL");
  const secret = "synthetic-sensitive-value";
  const result = await execute(
    process.execPath,
    ["-e", "process.stdout.write(process.env.TEST_API_KEY)"],
    30_000,
    { ...process.env, TEST_API_KEY: secret }
  );
  assert(!result.output.includes(secret));
  assert(!redact("Bearer synthetic-token https://user:password@example.org").includes("password"));
});
test("license parser rejects malformed shape, unknown expressions and unrestricted exceptions", () => {
  for (const report of [
    null,
    {},
    [],
    { MIT: {} },
    { MIT: [] },
    { MIT: [{}] },
    { MIT: [{ name: "x", versions: [1] }] },
    { MIT: [{ name: "x", versions: [" "] }] },
  ])
    assert.throws(() => validateLicenseReport(report));
  const report = (license: string, name = "fixture") => ({
    [license]: [{ name, versions: ["1.0.0"], license }],
  });
  assert.deepEqual(validateLicenseReport(report("(MIT OR Apache-2.0)")), []);
  for (const expression of [
    "Unknown",
    "MIT OR nonsense",
    "MIT OR GPL-2.0-only",
    "MIT AND",
    "FSL-1.1-MIT",
    "LicenseRef-Proprietary",
    "MIT OR LicenseRef-Commercial",
    "DocumentRef-vendor:LicenseRef-Custom",
  ])
    assert(validateLicenseReport(report(expression)).length);
  assert(validateLicenseReport(report("GPL-2.0-or-later", "@ffmpeg/core")).length);
  assert(
    validateLicenseReport({ "GPL-2.0-or-later": [{ name: "@ffmpeg/core", versions: ["0.12.9"] }] })
      .length
  );
});
test("duplication structure, finite totals, root coverage, stale and new findings", () => {
  const root = process.cwd();
  const now = Date.now();
  const baseline = {
    schemaVersion: 1,
    roots: ["src", "scripts", "workers"],
    total: { clones: 0, duplicatedLines: 0, percentage: 0 },
    fingerprints: [],
  };
  const report = {
    statistics: {
      total: { sources: 3, lines: 100, tokens: 200, clones: 0, duplicatedLines: 0, percentage: 0 },
      formats: {
        typescript: {
          sources: Object.fromEntries(
            baseline.roots.map((r) => [path.join(root, r, "fixture.ts"), {}])
          ),
        },
      },
    },
    duplicates: [],
  };
  assert.deepEqual(validateDuplication(report, baseline, now, now, root), []);
  assert.throws(() => validateDuplication(report, baseline, now - 1, now, root));
  for (const invalid of [
    {},
    { statistics: { total: {} }, duplicates: [] },
    {
      ...report,
      statistics: { ...report.statistics, total: { ...report.statistics.total, percentage: NaN } },
    },
  ])
    assert.throws(() => validateDuplication(invalid, baseline, now, now, root));
  assert.throws(() =>
    validateDuplication(report, { ...baseline, roots: ["missing"] }, now, now, root)
  );
  const duplicate = {
    fragment: "duplicated project code",
    lines: 8,
    tokens: 100,
    firstFile: { name: path.join(root, "src/a.ts") },
    secondFile: { name: path.join(root, "src/b.ts") },
  };
  assert(
    validateDuplication(
      {
        ...report,
        duplicates: [duplicate],
        statistics: {
          ...report.statistics,
          total: { ...report.statistics.total, clones: 1, duplicatedLines: 8, percentage: 1 },
        },
      },
      baseline,
      now,
      now,
      root
    ).length >= 2
  );
});
test("large one-line text and unusual filenames scanned; read failure explicit", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vm-secret-fixture-"));
  try {
    const file = path.join(dir, "quoted [fixture] name.txt");
    const secret = "sk_" + "live_" + "S".repeat(30);
    await writeFile(file, "x".repeat(1_100_000) + " " + secret + "\n");
    assert(
      (await scanFile(file)).findings.some((finding) => finding.includes("Stripe live secret"))
    );
    await writeFile(file, "corrected safe fixture");
    assert.deepEqual((await scanFile(file)).findings, []);
    await assert.rejects(scanFile(path.join(dir, "missing.txt")));
  } finally {
    if (!path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + "vm-secret-fixture-"))
      throw new Error("Unsafe fixture cleanup");
    await rm(dir, { recursive: true, force: true });
  }
});
test("security findings and errors can never be hidden by a quality baseline", () => {
  const finding = {
    file: "src/fixture.ts",
    rule: "fixture",
    message: "existing warning",
    fingerprint: "fixture",
    security: false,
    error: false,
  };
  const baseline = {
    schemaVersion: 1,
    findings: { fixture: 1 },
    rationale: "reviewed existing debt",
    commit: "fixture",
  };
  assert.deepEqual(qualityRegressions([finding], baseline), []);
  assert.equal(qualityRegressions([finding, finding], baseline).length, 1);
  assert.equal(qualityRegressions([{ ...finding, security: true }], baseline).length, 1);
  assert.equal(qualityRegressions([{ ...finding, error: true }], baseline).length, 1);
  assert.throws(() => qualityRegressions([], { ...baseline, findings: { fixture: NaN } }));
});
test("runner persists warning, exception, fail-fast, partial and dry-run evidence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vm-audit-report-"));
  const previous = process.env.SAFETY_GATE_REPORT_DIR;
  const previousExit = process.exitCode;
  process.env.SAFETY_GATE_REPORT_DIR = dir;
  try {
    await runAudit("review", ["--checks=lint,types", "--fail-fast"], async () => ({
      status: "FAIL",
      output: "WARN: fixture warning",
      exitCode: 1,
      durationMs: 1,
    }));
    let report = JSON.parse(await readFile(path.join(dir, "latest.json"), "utf8"));
    assert.equal(report.stepsExecuted, 1);
    assert.equal(report.results[1].status, "SKIPPED");
    assert.equal(report.warnings.length, 1);
    assert.equal(report.releaseReady, false);
    await runAudit("release", ["--checks=lint"], async () => {
      throw new Error("missing fixture executable");
    });
    report = JSON.parse(await readFile(path.join(dir, "latest.json"), "utf8"));
    assert.equal(report.assessment, "INCOMPLETE");
    assert.equal(report.results[0].status, "UNAVAILABLE");
    await runAudit("review", ["--checks=lint"], async () => ({
      status: "PASS",
      output:
        "! existing approved warning\nWARN workerd compatibility date\n▲ [WARNING] generated output\nWarning: build cache unavailable",
      exitCode: 0,
      durationMs: 1,
    }));
    report = JSON.parse(await readFile(path.join(dir, "latest.json"), "utf8"));
    assert.equal(report.assessment, "WARN");
    assert.equal(report.warnings.length, 4);
    await runAudit("release", ["--dry-run", "--skip-optional"], async () => {
      throw new Error("dry run executed");
    });
    report = JSON.parse(await readFile(path.join(dir, "latest.json"), "utf8"));
    assert.equal(report.stepsExecuted, 0);
    assert.deepEqual(report.controlEvidence, []);
    assert.equal(report.releaseReady, false);
    await runAudit("review", ["--unsupported"]);
    report = JSON.parse(await readFile(path.join(dir, "latest.json"), "utf8"));
    assert.equal(report.assessment, "FAIL");
    assert.equal(report.stepsExecuted, 0);
  } finally {
    if (previous === undefined) delete process.env.SAFETY_GATE_REPORT_DIR;
    else process.env.SAFETY_GATE_REPORT_DIR = previous;
    process.exitCode = previousExit;
    if (!path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + "vm-audit-report-"))
      throw new Error("Unsafe fixture cleanup");
    await rm(dir, { recursive: true, force: true });
  }
});
test("network/malformed dependency reports never pass", () => {
  for (const value of [{ error: { code: "ENOTFOUND" } }, {}, null])
    assert.equal(dependencyAuditVerdict(0, value), "INVALID");
});
test("project skills use maintained commands and resolvable guides", async () => {
  for (const [name, command] of [
    ["code-review-security-auditor", "safety:review"],
    ["release-readiness-synthesizer", "safety:release"],
    ["payment-auditor", "payments:audit"],
    ["kyc-auditor", "kyc:audit"],
  ]) {
    const text = await readFile(`.agents/skills/${name}/SKILL.md`, "utf8");
    assert(text.startsWith("---\n") || text.startsWith("---\r\n"));
    assert(text.includes(command));
    assert(text.includes("INCOMPLETE"));
    assert(text.includes("code"));
    for (const match of text.matchAll(/\]\(([^)]+\.md)\)/g))
      await readFile(path.resolve(`.agents/skills/${name}`, match[1]), "utf8");
  }
});
