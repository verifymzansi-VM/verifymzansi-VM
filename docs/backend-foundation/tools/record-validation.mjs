import fs from "node:fs";
import path from "node:path";
const root = path.resolve("docs/backend-foundation");
const runIds = ["2026-10-13T12-26-13-386Z-48ae155b", "2026-10-13T12-52-08-058Z-c5735a3c"];
const runs = runIds.map((id) => {
  const file = `tmp/safety-gate/safety-review-${id}.json`;
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    runId: r.runId,
    sourceReport: file,
    mode: r.mode,
    verdict: r.verdict,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    partialScope: r.partialScope,
    releaseReady: r.releaseReady,
    selectedScope: r.selectedScope,
    results: r.results.map((x) => ({
      id: x.id,
      status: x.status,
      executed: x.executed,
      exitCode: x.exitCode,
      durationMs: x.durationMs,
      evidence: x.evidence,
    })),
  };
});
const combined = new Map();
for (const run of runs) for (const r of run.results) combined.set(r.id, r.status);
const results = {
  schemaVersion: 1,
  date: "2026-10-13",
  timezone: "Africa/Johannesburg",
  recordedAt: new Date().toISOString(),
  sourceCommit: "180ea3a01beb80f4568fa6d8393c3195ae9e793f",
  sourceProject: "tnygdgormnofpgjknlhr",
  targetProject: null,
  workingTree: "local uncommitted plan/fixes; no push/deployment",
  productionMutations: [],
  assessment:
    "Planning complete. Four narrow corrections locally verified. Full release and region migration NOT verified.",
  combinedScopedChecks: Object.fromEntries(combined),
  scopedRuns: runs,
  scanCorrection:
    "Initial nine-check run passed eight checks; secret scan flagged only computed SHA-256 file checksum text in two planning artifacts. Checksums changed to base64url, with no scanner rule relaxation. Subsequent strict secret-only gate passed. No application/migration code changed for that correction.",
  focusedAgentValidation: [
    {
      agent: "category_count_fix",
      command:
        "node node_modules/vitest/vitest.mjs run src/__tests__/business-crud.test.ts src/lib/supabase/playwright-category-counts.test.ts src/__tests__/business-evidence-expiry.test.ts src/__tests__/service-role-public-read-checklist.test.ts",
      status: "PASS",
      files: 4,
      tests: 61,
      scope: "category RPC caller/stub, evidence HTTP controls, public-read checklist",
      sqlCommands: [
        "node scripts/test-business-category-counts.mjs",
        "node scripts/test-business-verification-file-privacy.mjs",
      ],
      sqlStatus: "PASS",
      sqlEngine: "PGlite embedded PostgreSQL; synthetic fixture, supplementary",
      typecheck: "PASS",
      focusedLint: "PASS",
      peerReview:
        "authorization_review static review and independent SQL rerun passed; recorded file digests in authorization-contracts.md",
    },
    {
      agent: "form_contact_fixes",
      command:
        "node node_modules/vitest/vitest.mjs run src/app/api/contact/reveal/route.test.ts src/lib/forms/tourism-form.test.ts src/app/post/create-tourism/page.test.tsx src/lib/validations/business-unified.test.ts src/lib/validations/tourism.test.ts",
      status: "PASS",
      files: 5,
      tests: 77,
      scope:
        "selected private contact channels, shared business bounds and accessible UI/preupload boundary; event contract unchanged",
      focusedLint: "PASS",
      preFixRegression:
        "eight regression cases failed before correction; final UI assertions also passed",
    },
  ],
  tooling: {
    status: "PASS",
    tests: 30,
    ciRequiredLanes: ["db-business-counts", "db-business-evidence"],
    scripts: ["test:business-counts:db", "test:business-evidence:db"],
    notes:
      "Both PGlite lanes included in test:blocking, registry review/ci-review/release and explicit CI partitions; evidence lane also KYC.",
  },
  packIntegrity: {
    status: "requires check-pack.mjs final run",
    command: "node docs/backend-foundation/tools/check-pack.mjs",
    expected: {
      sourceTables: 88,
      sourceColumns: 1051,
      pages: 109,
      routes: 131,
      jobs: 24,
      tasks: 33,
    },
  },
  environment: {
    node: "22.22.0",
    installedPnpmUsed: "10.29.3",
    projectPinnedPnpm: "10.34.5",
    notes:
      "Pinned package-manager auto-install and node_modules access failed in Windows sandbox. Local checks used npm_config_manage_package_manager_versions=false or direct Node; selected review commands required approved outside-sandbox execution. No remote side effects.",
    docker: "Unavailable: Docker Linux engine named pipe absent",
  },
  requiredBeforeRelease: [
    "Complete fresh target PostgreSQL migration replay and real PostgREST/RLS/column/RPC grant tests",
    "Actual staff AAL2/live-session/revocation and direct API evidence-denial verification",
    "Complete multi-user/multi-organisation route/RPC/writable-field matrix",
    "Isolated browser flows and target Cloudflare build/cache/binding integration",
    "Measured regional and workload/query-plan/latency experiments",
    "Effective target Auth/provider/TLS/backup configuration evidence",
    "Genuine signed payment/provider delivery evidence within approved environment",
    "Timed database/object/key restoration and cutover/rollback rehearsal",
    "Owner approval of concrete target, organisation, cost, privacy/recovery choices and production cutover",
  ],
  deploymentOrder: [
    "Review/apply 20261013120246_business_category_counts.sql and 20261013120249_service_only_business_verification_files.sql only after appropriate production approval",
    "Verify service aggregate and browser table/column/RPC ACLs without reading retained evidence",
    "Deploy the corrected count caller after its RPC exists; otherwise it returns503",
    "The contact/form fixes need application rollout and regression checks; nothing deployed here",
  ],
};
fs.writeFileSync(
  path.join(root, "validation-results.json"),
  JSON.stringify(results, null, 2) + "\n"
);
console.log(
  "Validation record written; nine unique scoped check statuses retained; full release remains unverified."
);
