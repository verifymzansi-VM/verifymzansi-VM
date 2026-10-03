import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile, cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
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
import { assessPatchedAudit, verifyBracesBackport, BRACES_ADVISORY } from "./lib/braces-backport";
test("Sentry approval is confined to verified internal tooling packages and terms", async () => {
  const review = JSON.parse(await readFile("scripts/license-reviews/sentry-cli.json", "utf8"));
  const licenseText = await readFile("node_modules/@sentry/cli/LICENSE", "utf8");
  const evidence = { review, licenseText };
  const report = (name = "@sentry/cli", version = "2.58.6", license = "FSL-1.1-MIT") => ({
    [license]: [{ name, versions: [version], license }],
  });
  for (const name of ["@sentry/cli", "@sentry/cli-win32-x64", "@sentry/cli-linux-x64"])
    assert.deepEqual(validateLicenseReport(report(name), "", undefined, evidence), []);
  for (const invalid of [
    undefined,
    { review: { ...review, competingUse: true }, licenseText },
    { review: { ...review, useCase: "public-CLI-service" }, licenseText },
    { review, licenseText: licenseText + "changed" },
  ])
    assert(validateLicenseReport(report(), "", undefined, invalid).length);
  for (const unreviewed of [
    report("@sentry/new-package"),
    report("@sentry/cli", "2.58.7"),
    report("@sentry/cli", "2.58.6", "GPL-3.0-only"),
  ])
    assert(validateLicenseReport(unreviewed, "", undefined, evidence).length);
});
test("installed braces guards all public string and AST walkers with bounded errors", () => {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const braces = require("braces");
  const nested = (depth: number) => "{".repeat(depth) + "a,b" + "}".repeat(depth);
  for (const name of ["parse", "compile", "expand", "stringify"]) {
    for (const options of [{}, { maxDepth: 10000 }, { maxDepth: Infinity }, { maxDepth: NaN }])
      assert.throws(() => braces[name](nested(4000), options), /exceeds max depth/);
    assert.throws(() => braces[name](nested(101)), /exceeds max depth/);
    assert.doesNotThrow(() => braces[name](nested(100)));
    assert.throws(() => braces[name]("(".repeat(101) + "a" + ")".repeat(101)), /exceeds max depth/);
  }
  for (const name of ["compile", "expand", "stringify"]) {
    let ast: { type: string; value?: string; nodes?: unknown[] } = { type: "text", value: "a" };
    for (let level = 0; level < 101; level++) ast = { type: "brace", nodes: [ast] };
    assert.throws(() => braces[name]({ type: "root", nodes: [ast] }), /exceeds max depth/);
  }
  const cycle: { type: string; nodes: unknown[]; parent?: unknown } = {
    type: "paren",
    nodes: [{ type: "text", value: "a" }],
  };
  cycle.parent = cycle;
  assert.throws(
    () => runInNewContext("braces.expand(cycle)", { braces, cycle }, { timeout: 1000 }),
    /parent chain contains a cycle/
  );
  assert.deepEqual(braces.expand("file-{a,b}-{1..3}.js"), [
    "file-a-1.js",
    "file-a-2.js",
    "file-a-3.js",
    "file-b-1.js",
    "file-b-2.js",
    "file-b-3.js",
  ]);
  assert.equal(braces.compile("foo/{a,b}/bar"), "foo/(a|b)/bar");
});
test("audit retains other findings and requires the exact verified backport", async () => {
  assert.equal((await verifyBracesBackport()).verified, true);
  const report = {
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
    advisories: {
      known: {
        github_advisory_id: BRACES_ADVISORY,
        module_name: "braces",
        severity: "high",
        findings: [{ version: "3.0.3" }],
      },
    },
  };
  assert.equal(assessPatchedAudit(1, report, { verified: false }).assessment, "FAIL");
  assert.equal(assessPatchedAudit(1, report, { verified: true }).assessment, "WARN");
  assert.equal(report.metadata.vulnerabilities.high, 1);
  assert.equal(assessPatchedAudit(2, report, { verified: true }).assessment, "INVALID");
  const extra = {
    ...report,
    metadata: { vulnerabilities: { ...report.metadata.vulnerabilities, critical: 1 } },
    advisories: {
      ...report.advisories,
      other: {
        github_advisory_id: "unrelated",
        module_name: "another",
        severity: "critical",
        findings: [{ version: "1" }],
      },
    },
  };
  assert.equal(assessPatchedAudit(1, extra, { verified: true }).assessment, "FAIL");
  assert.equal(
    assessPatchedAudit(1, { ...extra, metadata: report.metadata }, { verified: true }).assessment,
    "INVALID"
  );
  assert.equal(
    assessPatchedAudit(
      1,
      {
        ...report,
        advisories: { known: { ...report.advisories.known, findings: [{ version: "3.0.2" }] } },
      },
      { verified: true }
    ).assessment,
    "FAIL"
  );
  const directory = await mkdtemp(path.join(tmpdir(), "vm-braces-proof-"));
  try {
    await mkdir(path.join(directory, "patches"));
    await cp("patches", path.join(directory, "patches"), { recursive: true });
    await cp("package.json", path.join(directory, "package.json"));
    await cp("node_modules/braces", path.join(directory, "node_modules/braces"), {
      recursive: true,
    });
    // Exercise a runnable isolated installation, including braces' dependencies.
    for (const dependency of ["fill-range", "to-regex-range", "is-number"])
      await cp(`node_modules/${dependency}`, path.join(directory, "node_modules", dependency), {
        recursive: true,
      });
    assert.equal((await verifyBracesBackport(directory)).verified, true);
    await mkdir(path.join(directory, "node_modules/consumer/node_modules/braces"), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, "node_modules/consumer/node_modules/braces/package.json"),
      '{"version":"3.0.3","main":"index.js"}'
    );
    assert.equal((await verifyBracesBackport(directory)).verified, false);
    await rm(path.join(directory, "node_modules/consumer"), { recursive: true });
    await writeFile(
      path.join(directory, "node_modules/braces/lib/parse.js"),
      "unpatched or modified"
    );
    assert.equal((await verifyBracesBackport(directory)).verified, false);
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + "vm-braces-proof-"))
      throw new Error("Unsafe fixture cleanup");
    await rm(directory, { recursive: true, force: true });
  }
});
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
test("Remotion free license requires owner eligibility, exact packages/version and unchanged terms", async () => {
  const review = JSON.parse(await readFile("scripts/license-reviews/remotion.json", "utf8"));
  const licenseText = await readFile("node_modules/remotion/LICENSE.md", "utf8");
  const evidence = { review, licenseText };
  const report = (name = "@remotion/cli", version = "4.0.529", expression = "Unknown") => ({
    [expression]: [{ name, versions: [version], license: expression }],
  });
  for (const name of [
    "remotion",
    "@remotion/cli",
    "@remotion/bundler",
    "@remotion/compositor-win32-x64-msvc",
    "@remotion/compositor-linux-x64-gnu",
    "@remotion/media",
    "@remotion/player",
    "@remotion/renderer",
    "@remotion/web-renderer",
  ])
    assert.deepEqual(validateLicenseReport(report(name), "", evidence), []);
  for (const [name, expression] of [
    ["@remotion/canvas", "Remotion License"],
    ["@remotion/studio-protocol", "Remotion License"],
    ["@remotion/media-parser", "Remotion License https://remotion.dev/license"],
  ])
    assert.deepEqual(validateLicenseReport(report(name, "4.0.529", expression), "", evidence), []);
  assert.deepEqual(
    validateLicenseReport(report(), "", {
      review: { ...review, companyEmployeeCount: 3 },
      licenseText,
    }),
    []
  );
  assert.deepEqual(
    validateLicenseReport(report(), "", {
      review,
      licenseText: licenseText.replace(/\r?\n/g, "\r\n"),
    }),
    []
  );
  for (const invalid of [
    undefined,
    { review: null, licenseText },
    { review: { ...review, companyEmployeeCount: 4 }, licenseText },
    { review: { ...review, companyEmployeeCount: "1" }, licenseText },
    { review: { ...review, declaredBy: "unknown" }, licenseText },
    { review: { ...review, useCase: "reselling-Remotion" }, licenseText },
    { review, licenseText: licenseText + "changed terms" },
  ])
    assert(validateLicenseReport(report(), "", invalid).length);
  for (const unreviewed of [
    report("@remotion/new-package"),
    report("unrelated"),
    report("remotion", "4.0.530"),
    report("remotion", "4.0.529", "GPL-3.0-only"),
    report("@sentry/cli", "2.58.6", "FSL-1.1-MIT"),
  ])
    assert(validateLicenseReport(unreviewed, "", evidence).length);
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
