import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Fixed offline commands only. Never load .env, invoke a migration, or accept a URL.
const root = path.resolve("docs/backend-foundation");
const runId = new Date().toISOString().replaceAll(":", "-");
const files = [
  "scripts/lib/backend-foundation.mjs",
  "scripts/check-backend-foundation.mjs",
  "scripts/backend-foundation.test.mjs",
  "scripts/test-foundation-transport.mjs",
  "docs/backend-foundation/tools/field-dispositions.mjs",
  "docs/backend-foundation/tools/field-dispositions.test.mjs",
];
const commands = [
  { id: "foundation-tooling", argv: ["--test", files[2], files[5]] },
  { id: "foundation-transport", argv: [files[3]], engine: "PGlite; supplementary only" },
  {
    id: "existing-count-fix",
    argv: ["scripts/test-business-category-counts.mjs"],
    engine: "PGlite; supplementary only",
  },
  {
    id: "existing-evidence-fix",
    argv: ["scripts/test-business-verification-file-privacy.mjs"],
    engine: "PGlite; supplementary only",
  },
  {
    id: "foundation-lint",
    argv: ["node_modules/eslint/bin/eslint.js", ...files, "--max-warnings=0"],
  },
  {
    id: "foundation-format",
    argv: [
      "node_modules/prettier/bin/prettier.cjs",
      "--check",
      ...files,
      "docs/backend-foundation/resource-manifest.json",
      "docs/backend-foundation/region-experiment.md",
      "docs/backend-foundation/prototypes/transport-contracts.json",
      "docs/backend-foundation/implementation-progress.md",
    ],
  },
  {
    id: "declared-staging-isolation",
    argv: [files[1], "isolation", "docs/backend-foundation/resource-manifest.json", "staging"],
    expectedExit: 1,
    expectedJsonStatus: "FAIL",
  },
  {
    id: "field-dispositions",
    argv: [files[4], "check"],
    expectedExit: 1,
    expectedJsonStatus: "INCOMPLETE",
  },
];
const outputDir = path.join(root, "evidence", "implementation-local", runId);
fs.mkdirSync(outputDir, { recursive: true });
const results = [];
for (const command of commands) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const result = spawnSync(process.execPath, command.argv, { encoding: "utf8", timeout: 120000 });
  const log = path.join(outputDir, `${command.id}.log`);
  fs.writeFileSync(log, (result.stdout ?? "") + (result.stderr ?? ""));
  let expectedJsonMatches = true;
  if (command.expectedJsonStatus) {
    try {
      expectedJsonMatches = JSON.parse(result.stdout).status === command.expectedJsonStatus;
    } catch {
      expectedJsonMatches = false;
    }
  }
  results.push({
    id: command.id,
    command: ["node", ...command.argv],
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - start),
    exitCode: result.status,
    status: result.error
      ? "INCOMPLETE"
      : result.status === (command.expectedExit ?? 0) && expectedJsonMatches
        ? command.expectedExit === 1
          ? "EXPECTED_INCOMPLETE_OR_DENIAL"
          : "PASS"
        : "FAIL",
    engine: command.engine ?? "offline Node",
    evidence: path.relative(root, log).replaceAll("\\", "/"),
  });
}
const sourceInventory = JSON.parse(
  fs.readFileSync(path.join(root, "evidence/source-inventory.json"), "utf8")
);
const digest = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("base64url");
const sourceDrift = sourceInventory
  .filter((row) => !fs.existsSync(row.file) || digest(row.file) !== row.sha256Base64url)
  .map((row) => row.file);
const existingReviewHashes = {
  "supabase/migrations/20261013120246_business_category_counts.sql":
    "vpy2BxqL35tC03cwKdR11yS_q9Hn1ZXZMdkJAYToro0",
  "supabase/migrations/20261013120249_service_only_business_verification_files.sql":
    "_nXOpVflQn6WVORDjzRUPCZ2UYIqbKEvgdwUc-qmi8A",
  "scripts/test-business-category-counts.mjs": "wDSxDxXwY7sZRWOg-8jNzPTyXJsb9vXW2cKiCnvKi5A",
  "scripts/test-business-verification-file-privacy.mjs":
    "HM3KHAfhnUpO7kZourpbRybhyTv6IWnLC5kbecnFMTQ",
  "src/app/api/businesses/route.ts": "AmPa8PFxTp0tbm8yH-D5RVKVDPDHXMjAqpHO1gNdn1Y",
  "src/lib/supabase/playwright-stub.ts": "3gwk2DcR5JP3grbeZtN3jweoQubbMbJ1F8FQOmsvkbU",
};
const hashMatches = Object.entries(existingReviewHashes).map(([file, expected]) => ({
  file,
  expected,
  actual: digest(file),
  matches: digest(file) === expected,
}));
const run = {
  schemaVersion: 1,
  runId,
  recordedAt: new Date().toISOString(),
  timezone: "Africa/Johannesburg",
  sourceCommit: "180ea3a01beb80f4568fa6d8393c3195ae9e793f",
  targetProject: null,
  scope: "First additive local foundation slice; not release evidence",
  releaseReady: false,
  productionMutations: [],
  results,
  sourceDrift,
  existingReviewHashes: hashMatches,
  fileHashes: Object.fromEntries(
    [...files, "docs/backend-foundation/prototypes/transport.sql"].map((file) => [
      file,
      digest(file),
    ])
  ),
  independentReview: {
    status: "PASS",
    scope: "bounded offline tools and PGlite prototype only",
    evidence: "implementation-review.md",
  },
  incomplete: [
    "Native PostgreSQL/PostgREST/grant/race proof",
    "Regional measurements and final selection",
    "Resource capacity, runtime bindings and secret provenance",
    "Detailed field/page/method contract decisions",
    "Privacy/scanning provider decisions",
    "Actual recovery drill",
    "BF-12 and BF-28",
    "Provider delivery and live approval",
  ],
  priorFixVitestAttempt: {
    status: "INCOMPLETE",
    exitCode: 1,
    files: 9,
    testsExecuted: 0,
    command:
      "node node_modules/vitest/vitest.mjs run src/__tests__/business-crud.test.ts src/lib/supabase/playwright-category-counts.test.ts src/__tests__/business-evidence-expiry.test.ts src/__tests__/service-role-public-read-checklist.test.ts src/app/api/contact/reveal/route.test.ts src/lib/forms/tourism-form.test.ts src/app/post/create-tourism/page.test.tsx src/lib/validations/business-unified.test.ts src/lib/validations/tourism.test.ts",
    reason:
      "Vite setup resolution failed: EPERM realpath src/test/setup.ts. No assertions executed; prior handoff passes preserved, not treated as current rerun proof.",
  },
};
fs.writeFileSync(
  path.join(root, "evidence/implementation-run.json"),
  JSON.stringify(run, null, 2) + "\n"
);
const immutableRecord = `evidence/implementation-local/${runId}/run.json`;
fs.writeFileSync(path.join(root, immutableRecord), JSON.stringify(run, null, 2) + "\n", {
  flag: "wx",
});
const validationFile = path.join(root, "validation-results.json");
const validation = JSON.parse(fs.readFileSync(validationFile, "utf8"));
validation.implementationRuns ??= [];
validation.implementationRuns.push({
  recordedAt: run.recordedAt,
  evidence: immutableRecord,
  releaseReady: false,
});
fs.writeFileSync(validationFile, JSON.stringify(validation, null, 2) + "\n");
process.stdout.write(
  JSON.stringify(
    {
      results: results.map(({ id, status }) => ({ id, status })),
      sourceDrift,
      existingReviewHashesMatch: hashMatches.every((row) => row.matches),
      releaseReady: false,
    },
    null,
    2
  ) + "\n"
);
process.exitCode =
  results.some((row) => ["FAIL", "INCOMPLETE"].includes(row.status)) ||
  sourceDrift.length ||
  hashMatches.some((row) => !row.matches)
    ? 1
    : 0;
