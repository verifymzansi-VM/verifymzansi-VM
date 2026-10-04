export type AuditMode = "review" | "ci-review" | "release" | "payments" | "kyc" | "inventory";
export type Check = {
  id: string;
  name: string;
  args: string[];
  scopes: AuditMode[];
  scope: string;
  exclusions: string;
  dependencies: string[];
  tests: string[];
  evidence: string[];
  category: "repo_runtime" | "live_deployment" | "local_production_env";
  advisory?: boolean;
  optional?: boolean;
  external?: boolean;
  unavailable?: string;
  coveredBy?: string;
  timeoutMs: number;
};
const local: AuditMode[] = ["review", "ci-review", "release", "payments", "kyc"];
const full: AuditMode[] = ["review", "ci-review", "release"];
function check(
  id: string,
  args: string[],
  scope: string,
  scopes = local,
  extra: Partial<Check> = {}
): Check {
  return {
    id,
    name: id,
    args,
    scopes,
    scope,
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["scripts/audit-tooling.test.ts"],
    evidence: [`per-run ${id}.log`],
    category: "repo_runtime",
    timeoutMs: 600_000,
    ...extra,
  };
}
// Single policy source for local gates, CI partitions, release and domain audits.
export const CHECKS: Check[] = [
  check("format", ["format:check"], "src, workers, scripts, configs, maintained skills/guides"),
  check("lint", ["lint"], "src, scripts, workers; ESLint security and accessibility rules"),
  check(
    "types",
    ["typecheck"],
    "tsconfig.typecheck.json; generated routes verified by isolated build"
  ),
  check(
    "tooling",
    ["test:tooling"],
    "runner/parser/scanner/policy regression and Lighthouse tests"
  ),
  check("openapi", ["quality:openapi-drift"], "docs/openapi.json versus generated declarations"),
  check("dead-code", ["knip"], "Next file conventions, workers, scripts, remotion and CI", local, {
    exclusions: "knip.jsonc: generated declarations, output and reviewed ignoreIssues",
  }),
  check("imports", ["depcruise"], "src, scripts, workers import boundaries"),
  check("duplication", ["jscpd:check"], "src, scripts, workers executable code", local, {
    exclusions: ".jscpd.json: tests, generated/vendor, reviewed aliases",
    evidence: ["tmp/jscpd/jscpd-report.json", "scripts/audit-baselines/duplication.json"],
  }),
  check(
    "secrets",
    ["secret-scan:strict"],
    "Git tracked/untracked source plus built artifacts; streaming",
    local,
    {
      exclusions:
        "binary extensions and transient compiler caches; deterministic fixture values, annotated exceptions, skills-lock computedHash and generic generated 64-hex hashes; named credential rules remain active",
    }
  ),
  check(
    "dependencies",
    ["security:audit:all"],
    "resolved production and dev lockfile vulnerabilities",
    local,
    {
      dependencies: ["registry network access"],
      evidence: ["tmp/dependency-audit/latest.json"],
      timeoutMs: 180_000,
    }
  ),
  check(
    "licenses",
    ["licenses:check"],
    "resolved dependencies, SPDX expressions and FFmpeg exception",
    local,
    { evidence: ["public/vendor/ffmpeg-core/NOTICE.txt", "per-run licenses.log"] }
  ),
  check(
    "db-static",
    ["db:check-invariants"],
    "static migration corpus invariants; supplementary only"
  ),
  check(
    "contracts",
    ["test:contract"],
    "Ozow full/thin official event fixtures, shared KYC schema, SMS/email"
  ),
  check("canaries", ["test:security-canaries"], "security assertions; no mutation score"),
  check(
    "unit",
    ["exec", "vitest", "run"],
    "all blocking application tests including coverage-excluded suites",
    full,
    { timeoutMs: 1_800_000 }
  ),
  check(
    "payment-unit",
    ["test:payments"],
    "billing, paid add-ons, invoices, reconciliation, signatures",
    ["payments", "release"],
    { coveredBy: "unit" }
  ),
  check(
    "kyc-unit",
    ["test:kyc"],
    "manual/stub KYC upload, crypto, provider, evidence, review permissions",
    ["kyc", "release"],
    { coveredBy: "unit" }
  ),
  ...[
    "trials",
    "commercial:db",
    "payments:db",
    "media:db",
    "visits:db",
    "staff-roles:db",
    "decisions:db",
    "queue-claims:db",
    "operation-jobs:db",
    "dsar:db",
    "dashboard:db",
    "admin-lists:db",
    "kyc:db",
  ].map((lane) =>
    check(
      `db-${lane.replace(/:db$/, "")}`,
      [`test:${lane}`],
      "isolated PGlite assertions; limited migration/concurrency model",
      lane === "payments:db" ? [...full, "payments"] : lane === "kyc:db" ? [...full, "kyc"] : full
    )
  ),
  check(
    "coverage",
    ["test:coverage:core"],
    "core thresholds unchanged; six DOM-heavy suites run in unit",
    full,
    { evidence: ["coverage/coverage-final.json"], timeoutMs: 1_800_000 }
  ),
  check("preflight", ["preflight"], "local development environment", local, {
    category: "local_production_env",
    coveredBy: "preflight-production",
  }),
  check(
    "preflight-production",
    ["preflight:prod"],
    "production config plus read-only service authentication/reachability; no payments",
    ["release", "payments", "kyc"],
    { category: "local_production_env", external: true }
  ),
  check(
    "isolated-db",
    ["test:db:isolated"],
    "full migrations, PostgreSQL/PostgREST RLS, independent-session races",
    ["release", "payments", "kyc"],
    { dependencies: ["Docker daemon", "Supabase CLI"], timeoutMs: 1_800_000 }
  ),
  check(
    "browser",
    ["test:browser:isolated"],
    "critical smoke, billing, KYC, DSAR flows; isolated build and bundle budget",
    ["release", "payments", "kyc"],
    {
      dependencies: ["Playwright Chromium"],
      exclusions: "WebKit/mobile-safari quarantine; authenticated scenarios need test credentials",
      evidence: ["tmp/isolated-browser/latest.json"],
      timeoutMs: 1_800_000,
    }
  ),
  check(
    "launch-env",
    ["validate:launch-env"],
    "workstation production config; not deployed config",
    ["release", "payments", "kyc"],
    { category: "local_production_env" }
  ),
  check(
    "cloudflare-adapter",
    ["exec", "node", "scripts/preflight-cloudflare.js", "--validate-only"],
    "read-only local Cloudflare adapter/proxy compatibility and configuration",
    ["release"],
    {
      tests: ["src/__tests__/cloudflare-preflight.test.ts"],
      exclusions:
        "No build, environment rewrite, deployment or remote mutation; final Worker build still required",
    }
  ),
  check(
    "kyc-auth-browser",
    ["test:browser:isolated"],
    "authenticated synthetic ID/selfie, evidence, final approval and independent high-risk governance UI",
    ["release", "payments", "kyc"],
    {
      coveredBy: "browser",
      dependencies: [
        "isolated production Next build",
        "Chromium",
        "synthetic auth/database/storage fixtures",
      ],
      timeoutMs: 1_800_000,
      exclusions: "Real PostgreSQL/RLS and genuine provider delivery are separate requirements",
      tests: [
        "e2e/kyc-authenticated.spec.ts",
        "src/lib/supabase/playwright-governance.test.ts",
        "scripts/lib/kyc-browser-evidence.ts",
      ],
    }
  ),
  check(
    "cloudflare-build",
    ["build:cloudflare"],
    "isolated production Worker bundle and runtime-binding integration",
    ["release"],
    {
      unavailable:
        "Isolated Worker runtime-binding integration fixture is still missing; separate successful Worker builds, config checks and sanitizer fixtures do not attest runtime bindings",
      dependencies: [
        "isolated Linux/macOS checkout",
        "build-time public config",
        "Worker runtime-binding fixtures",
      ],
      tests: [
        "scripts/audit-tooling.test.ts",
        "scripts/preflight-cloudflare.js",
        "scripts/sanitize-cloudflare-env.ts",
      ],
    }
  ),
  check(
    "cloudflare-secrets",
    ["cloudflare:secrets:check"],
    "read-only deployed secret names",
    ["release", "payments", "kyc"],
    { external: true, category: "live_deployment", dependencies: ["Cloudflare read access"] }
  ),
  check(
    "cloudflare-posture",
    ["cloudflare:posture:strict"],
    "read-only TLS/HSTS/DNS/health",
    ["release", "payments", "kyc"],
    { external: true, category: "live_deployment" }
  ),
  check("schema", ["db:verify-schema"], "read-only deployed schema", ["release"], {
    external: true,
    category: "live_deployment",
  }),
  check(
    "security-advisor",
    ["supabase:advisor:security:strict"],
    "read-only security advisor",
    ["release"],
    { external: true, category: "live_deployment" }
  ),
  check(
    "performance-advisor",
    ["supabase:advisor:performance"],
    "read-only performance advisor",
    ["release"],
    { external: true, advisory: true, category: "live_deployment" }
  ),
  check(
    "deployment-ci",
    ["exec", "tsx", "scripts/check-deployment-ci.ts"],
    "read-only deployed commit/workflows",
    ["release"],
    { external: true, category: "live_deployment" }
  ),
  check(
    "deployment-health",
    ["exec", "tsx", "scripts/check-deployment-health.ts"],
    "read-only deployed health",
    ["release"],
    { external: true, category: "live_deployment" }
  ),
  check(
    "lighthouse",
    ["quality:lighthouse"],
    "public accessibility/performance; advisory",
    ["release"],
    {
      optional: true,
      advisory: true,
      unavailable: "Run against isolated build; no shared-checkout build permitted",
    }
  ),
  check("performance", ["test:perf"], "staging HTTP latency/error budget", ["release"], {
    external: true,
    optional: true,
    advisory: true,
    unavailable: "Requires dedicated staging load target; excluded from this read-only audit",
  }),
  check("k6", ["test:perf:k6"], "advisory staging load", ["release"], {
    external: true,
    optional: true,
    advisory: true,
    unavailable: "Requires separately approved staging load target; excluded from read-only audit",
  }),
  check("codeql", [], "GitHub security-extended analysis", local, {
    advisory: true,
    unavailable: "Local CodeQL unavailable; CI requires ENABLE_CODEQL and code-scanning access",
  }),
  check("ozow-delivery", [], "genuine signed Ozow notification", ["release", "payments"], {
    unavailable: "Genuine delivery not verified by fixtures or secret-name checks",
    category: "live_deployment",
  }),
  check(
    "email-dns",
    ["email:domain:check"],
    "public MX/SPF/DKIM/DMARC DNS; not inbox delivery",
    ["release"],
    { external: true, advisory: true, optional: true, category: "live_deployment" }
  ),
  check(
    "http-smoke",
    ["test:smoke"],
    "public routes and rejected unauthenticated POSTs",
    ["inventory"],
    {
      unavailable:
        "POST probes must use an isolated test target; deployment deep health is the read-only check",
    }
  ),
  check(
    "dev-startup",
    ["test:dev-startup"],
    "local development startup and image-loader diagnostics",
    ["inventory"],
    {
      unavailable:
        "Excluded to preserve the active development server; production build is isolated",
    }
  ),
  check(
    "public-pages",
    ["test:public-verify"],
    "live public browser routes and Turnstile UI",
    ["inventory"],
    {
      unavailable:
        "Live browser may issue telemetry/challenge POSTs; excluded from strict read-only verification",
      external: true,
      advisory: true,
    }
  ),
  check(
    "live-pages",
    ["test:live-pages"],
    "public/user/admin browser scenarios and boundaries",
    ["inventory"],
    {
      unavailable:
        "Live browser POSTs and authenticated sessions require a separate scoped run; requested skips now exit 2",
      external: true,
      advisory: true,
    }
  ),
  check(
    "live-load",
    ["security:audit:live-load:strict"],
    "browser network payload/header/runtime observations",
    ["inventory"],
    {
      unavailable:
        "Live browser POST side effects are outside this read-only run; load testing excluded",
      external: true,
      advisory: true,
    }
  ),
  check(
    "video-worker",
    ["exec", "node", "scripts/test-video-worker.mjs"],
    "emitted FFmpeg worker and self-hosted WASM",
    ["inventory"],
    {
      unavailable:
        "Requires isolated completed build and Chromium; report separately from unit mocks",
    }
  ),
];
// The runner's tests verify orchestration, while these references identify the
// domain/configuration evidence a reviewer must also examine for each check.
for (const item of CHECKS) {
  const references: Record<string, string[]> = {
    format: [
      "scripts/audit-tooling.test.ts",
      "scripts/check-quality.ts",
      "scripts/audit-baselines/format.json",
    ],
    lint: [
      "scripts/audit-tooling.test.ts",
      "eslint.config.mjs",
      "scripts/audit-baselines/lint.json",
    ],
    types: ["tsconfig.typecheck.json", "Next generated types in the isolated build"],
    tooling: [
      "scripts/audit-tooling.test.ts",
      "scripts/checker-fixtures.test.ts",
      "scripts/run-lighthouse.test.mjs",
    ],
    "dead-code": ["scripts/checker-fixtures.test.ts", "knip.jsonc"],
    imports: ["scripts/checker-fixtures.test.ts", ".dependency-cruiser.cjs"],
    duplication: [
      "scripts/audit-tooling.test.ts",
      "scripts/checker-fixtures.test.ts",
      ".jscpd.json",
    ],
    secrets: [
      "src/__tests__/secret-scan.test.ts",
      "src/lib/security/secret-scan-cli.test.ts",
      "scripts/audit-tooling.test.ts",
    ],
    dependencies: [
      "src/__tests__/dependency-audit-policy.test.ts",
      "scripts/audit-tooling.test.ts",
    ],
    contracts: ["scripts/test-contract.ts", "src/test/contracts", "src/test/fixtures/contracts"],
    canaries: ["scripts/test-mutation.ts"],
    unit: ["vitest.config.ts", "src/**/*.test.{ts,tsx}"],
    "payment-unit": [
      "scripts/run-domain-tests.ts payments",
      "src/lib/payments/ozow.test.ts",
      "src/app/api/billing/**/route.test.ts",
    ],
    "kyc-unit": [
      "scripts/run-domain-tests.ts kyc",
      "src/lib/validations/kyc-webhook.test.ts",
      "src/app/api/webhooks/kyc/provider/route.test.ts",
    ],
    coverage: ["vitest.config.ts", "scripts/run-vitest.ts coverage-core"],
    preflight: ["src/__tests__/preflight-check.test.ts"],
    "preflight-production": ["src/__tests__/preflight-check.test.ts"],
    "isolated-db": ["scripts/test-isolated-db.ts", "scripts/test-db.ts", "supabase/migrations"],
    browser: [
      "e2e/smoke.spec.ts",
      "e2e/addon-checkout.spec.ts",
      "e2e/billing-payment-roundtrip.spec.ts",
      "e2e/kyc-verification.spec.ts",
      "e2e/dsar.spec.ts",
    ],
    lighthouse: ["scripts/run-lighthouse.test.mjs", "lighthouse.config.json"],
    "http-smoke": ["src/__tests__/test-smoke-script.test.ts"],
    "video-worker": ["scripts/test-video-worker.mjs"],
  };
  item.tests = references[item.id] ?? [
    ...item.tests,
    `Implementation/configuration for ${item.args.join(" ") || item.scope}; external provider proof remains separate`,
  ];
}
export function selectChecks(mode: AuditMode, ids?: string[]): Check[] {
  if (ids?.some((id) => !CHECKS.some((check) => check.id === id)))
    throw new Error("Unknown check id");
  const selected = CHECKS.filter((check) =>
    ids ? ids.includes(check.id) : mode === "inventory" || check.scopes.includes(mode)
  );
  return selected.filter(
    (check) => !check.coveredBy || !selected.some((other) => other.id === check.coveredBy)
  );
}
