import {
  useState,
  useHostTheme,
  Stack,
  Row,
  Grid,
  H1,
  H2,
  Text,
  Table,
  Stat,
  Select,
  TextInput,
  Button,
  Callout,
} from "cursor/canvas";
const checks = [
  {
    id: "format",
    command: "pnpm format:check",
    status: "WARN",
    scope: "src, workers, scripts, configs, maintained skills/guides",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "pnpm format:check: WARN; inspect tmp\\safety-gate\\2026-10-03T10-04-03-949Z-7e163e15\\format.log",
    evidence: ["tmp\\safety-gate\\2026-10-03T10-04-03-949Z-7e163e15\\format.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "scripts/check-quality.ts",
      "scripts/audit-baselines/format.json",
    ],
    category: "repo_runtime",
  },
  {
    id: "lint",
    command: "pnpm lint",
    status: "WARN",
    scope: "src, scripts, workers; ESLint security and accessibility rules",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "pnpm lint: WARN; inspect tmp\\safety-gate\\2026-10-03T10-04-03-949Z-7e163e15\\lint.log",
    evidence: ["tmp\\safety-gate\\2026-10-03T10-04-03-949Z-7e163e15\\lint.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "eslint.config.mjs",
      "scripts/audit-baselines/lint.json",
    ],
    category: "repo_runtime",
  },
  {
    id: "types",
    command: "pnpm typecheck",
    status: "PASS",
    scope: "tsconfig.typecheck.json; generated routes verified by isolated build",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-58-07-545Z-5a8b4139\\types.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["tsconfig.typecheck.json", "Next generated types in the isolated build"],
    category: "repo_runtime",
  },
  {
    id: "tooling",
    command: "pnpm test:tooling",
    status: "PASS",
    scope: "runner/parser/scanner/policy regression and Lighthouse tests",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-51-22-967Z-ee336968\\tooling.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "scripts/checker-fixtures.test.ts",
      "scripts/run-lighthouse.test.mjs",
    ],
    category: "repo_runtime",
  },
  {
    id: "openapi",
    command: "pnpm quality:openapi-drift",
    status: "PASS",
    scope: "docs/openapi.json versus generated declarations",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-15-27-297Z-0d503700\\openapi.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for quality:openapi-drift; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "dead-code",
    command: "pnpm knip",
    status: "PASS",
    scope: "Next file conventions, workers, scripts, remotion and CI",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-58-07-545Z-5a8b4139\\dead-code.log"],
    exclusions: "knip.jsonc: generated declarations, output and reviewed ignoreIssues",
    dependencies: ["pnpm frozen install"],
    tests: ["scripts/checker-fixtures.test.ts", "knip.jsonc"],
    category: "repo_runtime",
  },
  {
    id: "imports",
    command: "pnpm depcruise",
    status: "PASS",
    scope: "src, scripts, workers import boundaries",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-58-07-545Z-5a8b4139\\imports.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["scripts/checker-fixtures.test.ts", ".dependency-cruiser.cjs"],
    category: "repo_runtime",
  },
  {
    id: "duplication",
    command: "pnpm jscpd:check",
    status: "PASS",
    scope: "src, scripts, workers executable code",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T10-04-03-949Z-7e163e15\\duplication.log"],
    exclusions: ".jscpd.json: tests, generated/vendor, reviewed aliases",
    dependencies: ["pnpm frozen install"],
    tests: ["scripts/audit-tooling.test.ts", "scripts/checker-fixtures.test.ts", ".jscpd.json"],
    category: "repo_runtime",
  },
  {
    id: "secrets",
    command: "pnpm secret-scan:strict",
    status: "PASS",
    scope: "Git tracked/untracked source plus built artifacts; streaming",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T10-04-03-949Z-7e163e15\\secrets.log"],
    exclusions:
      "binary extensions and transient compiler caches; deterministic fixture values, annotated exceptions, skills-lock computedHash and generic generated 64-hex hashes; named credential rules remain active",
    dependencies: ["pnpm frozen install"],
    tests: [
      "src/__tests__/secret-scan.test.ts",
      "src/lib/security/secret-scan-cli.test.ts",
      "scripts/audit-tooling.test.ts",
    ],
    category: "repo_runtime",
  },
  {
    id: "dependencies",
    command: "pnpm security:audit:all",
    status: "FAIL",
    scope: "resolved production and dev lockfile vulnerabilities",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "pnpm security:audit:all: FAIL; inspect tmp\\safety-gate\\2026-10-03T09-58-07-545Z-5a8b4139\\dependencies.log",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-58-07-545Z-5a8b4139\\dependencies.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["registry network access"],
    tests: ["src/__tests__/dependency-audit-policy.test.ts", "scripts/audit-tooling.test.ts"],
    category: "repo_runtime",
  },
  {
    id: "licenses",
    command: "pnpm licenses:check",
    status: "FAIL",
    scope: "resolved dependencies, SPDX expressions and FFmpeg exception",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "pnpm licenses:check: FAIL; inspect tmp\\safety-gate\\2026-10-03T09-58-07-545Z-5a8b4139\\licenses.log",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-58-07-545Z-5a8b4139\\licenses.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for licenses:check; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-static",
    command: "pnpm db:check-invariants",
    status: "PASS",
    scope: "static migration corpus invariants; supplementary only",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-15-27-297Z-0d503700\\db-static.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for db:check-invariants; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "contracts",
    command: "pnpm test:contract",
    status: "PASS",
    scope: "Ozow full/thin official event fixtures, shared KYC schema, SMS/email",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-15-27-297Z-0d503700\\contracts.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["scripts/test-contract.ts", "src/test/contracts", "src/test/fixtures/contracts"],
    category: "repo_runtime",
  },
  {
    id: "canaries",
    command: "pnpm test:security-canaries",
    status: "PASS",
    scope: "security assertions; no mutation score",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-15-27-297Z-0d503700\\canaries.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["scripts/test-mutation.ts"],
    category: "repo_runtime",
  },
  {
    id: "unit",
    command: "pnpm exec vitest run",
    status: "PASS",
    scope: "all blocking application tests including coverage-excluded suites",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp/safety-gate/2026-10-03T09-15-05-425Z-3462cf11/unit.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["vitest.config.ts", "src/**/*.test.{ts,tsx}"],
    category: "repo_runtime",
  },
  {
    id: "payment-unit",
    command: "pnpm test:payments",
    status: "PASS",
    scope: "billing, paid add-ons, invoices, reconciliation, signatures",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed through unit; identical/subset scope deduplicated",
    evidence: ["tmp/safety-gate/2026-10-03T09-15-05-425Z-3462cf11/unit.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/run-domain-tests.ts payments",
      "src/lib/payments/ozow.test.ts",
      "src/app/api/billing/**/route.test.ts",
    ],
    category: "repo_runtime",
  },
  {
    id: "kyc-unit",
    command: "pnpm test:kyc",
    status: "PASS",
    scope: "manual/stub KYC upload, crypto, provider, evidence, review permissions",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed through unit; identical/subset scope deduplicated",
    evidence: ["tmp/safety-gate/2026-10-03T09-15-05-425Z-3462cf11/unit.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/run-domain-tests.ts kyc",
      "src/lib/validations/kyc-webhook.test.ts",
      "src/app/api/webhooks/kyc/provider/route.test.ts",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-trials",
    command: "pnpm test:trials",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-trials.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:trials; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-commercial",
    command: "pnpm test:commercial:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-commercial.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:commercial:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-payments",
    command: "pnpm test:payments:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-payments.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:payments:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-media",
    command: "pnpm test:media:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-media.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:media:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-visits",
    command: "pnpm test:visits:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-visits.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:visits:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-staff-roles",
    command: "pnpm test:staff-roles:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-staff-roles.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:staff-roles:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-decisions",
    command: "pnpm test:decisions:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-decisions.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:decisions:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-queue-claims",
    command: "pnpm test:queue-claims:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-queue-claims.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:queue-claims:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-operation-jobs",
    command: "pnpm test:operation-jobs:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-operation-jobs.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:operation-jobs:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-dsar",
    command: "pnpm test:dsar:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-dsar.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:dsar:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-dashboard",
    command: "pnpm test:dashboard:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-dashboard.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:dashboard:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-admin-lists",
    command: "pnpm test:admin-lists:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-admin-lists.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:admin-lists:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "db-kyc",
    command: "pnpm test:kyc:db",
    status: "PASS",
    scope: "isolated PGlite assertions; limited migration/concurrency model",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-19-15-235Z-955634aa\\db-kyc.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:kyc:db; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "coverage",
    command: "pnpm test:coverage:core",
    status: "PASS",
    scope: "core thresholds unchanged; six DOM-heavy suites run in unit",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp/safety-gate/2026-10-03T09-15-05-425Z-3462cf11/coverage.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["vitest.config.ts", "scripts/run-vitest.ts coverage-core"],
    category: "repo_runtime",
  },
  {
    id: "preflight",
    command: "pnpm preflight",
    status: "WARN",
    scope: "local development environment",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "pnpm preflight: WARN; inspect tmp\\safety-gate\\2026-10-03T08-41-37-508Z-91beea49\\preflight.log",
    evidence: ["tmp\\safety-gate\\2026-10-03T08-41-37-508Z-91beea49\\preflight.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["src/__tests__/preflight-check.test.ts"],
    category: "local_production_env",
  },
  {
    id: "preflight-production",
    command: "pnpm preflight:prod",
    status: "PASS",
    scope: "production config plus read-only service authentication/reachability; no payments",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-13-08-356Z-89a8bb0b\\preflight-production.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["src/__tests__/preflight-check.test.ts"],
    category: "local_production_env",
  },
  {
    id: "isolated-db",
    command: "pnpm test:db:isolated",
    status: "UNAVAILABLE",
    scope: "full migrations, PostgreSQL/PostgREST RLS, independent-session races",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "pnpm test:db:isolated: UNAVAILABLE; inspect tmp\\kyc-audit\\2026-10-03T09-39-41-572Z-21f9705d\\isolated-db.log",
    evidence: ["tmp\\kyc-audit\\2026-10-03T09-39-41-572Z-21f9705d\\isolated-db.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["Docker daemon", "Supabase CLI"],
    tests: ["scripts/test-isolated-db.ts", "scripts/test-db.ts", "supabase/migrations"],
    category: "repo_runtime",
  },
  {
    id: "browser",
    command: "pnpm test:browser:isolated",
    status: "PASS",
    scope: "critical smoke, billing, KYC, DSAR flows; isolated build and bundle budget",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "50 passing desktop/mobile tests; two desktop skips pass on mobile. KYC authenticated submission/reviewer browser coverage remains incomplete separately.",
    evidence: [
      "tmp/isolated-browser/checkout-vkZFp0/.next/server/app-paths-manifest.json",
      "tmp/isolated-browser/bundle-standard-budget.log",
    ],
    exclusions: "WebKit/mobile-safari quarantine; authenticated scenarios need test credentials",
    dependencies: ["Playwright Chromium"],
    tests: [
      "e2e/smoke.spec.ts",
      "e2e/addon-checkout.spec.ts",
      "e2e/billing-payment-roundtrip.spec.ts",
      "e2e/kyc-verification.spec.ts",
      "e2e/dsar.spec.ts",
    ],
    category: "repo_runtime",
  },
  {
    id: "launch-env",
    command: "pnpm validate:launch-env",
    status: "PASS",
    scope: "workstation production config; not deployed config",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T08-41-37-508Z-91beea49\\launch-env.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for validate:launch-env; external provider proof remains separate",
    ],
    category: "local_production_env",
  },
  {
    id: "cloudflare-adapter",
    command: "pnpm exec node scripts/preflight-cloudflare.js --validate-only",
    status: "PASS",
    scope: "read-only local Cloudflare adapter/proxy compatibility and configuration",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-51-22-967Z-ee336968\\cloudflare-adapter.log"],
    exclusions:
      "No build, environment rewrite, deployment or remote mutation; final Worker build still required",
    dependencies: ["pnpm frozen install"],
    tests: [
      "src/__tests__/cloudflare-preflight.test.ts",
      "Implementation/configuration for exec node scripts/preflight-cloudflare.js --validate-only; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "kyc-auth-browser",
    command: "Evidence required; no executable lane configured",
    status: "UNAVAILABLE",
    scope: "authenticated synthetic KYC submission, evidence access and manual reviewer decisions",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "Isolated KYC browser fixtures currently cover anonymous/callback boundaries only; authenticated submission and reviewer fixtures need expansion",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "e2e/kyc-verification.spec.ts",
      "src/app/api/admin/kyc/**/route.test.ts",
      "Implementation/configuration for authenticated synthetic KYC submission, evidence access and manual reviewer decisions; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "cloudflare-build",
    command: "pnpm build:cloudflare",
    status: "UNAVAILABLE",
    scope: "isolated production Worker bundle and runtime-binding integration",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "Full Cloudflare Worker build/runtime-binding integration not executed in this audit; local config validation and sanitizer fixtures do not replace it",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: [
      "isolated Linux/macOS checkout",
      "build-time public config",
      "Worker runtime-binding fixtures",
    ],
    tests: [
      "scripts/audit-tooling.test.ts",
      "scripts/preflight-cloudflare.js",
      "scripts/sanitize-cloudflare-env.ts",
      "Implementation/configuration for build:cloudflare; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "cloudflare-secrets",
    command: "pnpm cloudflare:secrets:check",
    status: "PASS",
    scope: "read-only deployed secret names",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T08-41-37-508Z-91beea49\\cloudflare-secrets.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["Cloudflare read access"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for cloudflare:secrets:check; external provider proof remains separate",
    ],
    category: "live_deployment",
  },
  {
    id: "cloudflare-posture",
    command: "pnpm cloudflare:posture:strict",
    status: "PASS",
    scope: "read-only TLS/HSTS/DNS/health",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T08-41-37-508Z-91beea49\\cloudflare-posture.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for cloudflare:posture:strict; external provider proof remains separate",
    ],
    category: "live_deployment",
  },
  {
    id: "schema",
    command: "pnpm db:verify-schema",
    status: "PASS",
    scope: "read-only deployed schema",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T08-41-37-508Z-91beea49\\schema.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for db:verify-schema; external provider proof remains separate",
    ],
    category: "live_deployment",
  },
  {
    id: "security-advisor",
    command: "pnpm supabase:advisor:security:strict",
    status: "FAIL",
    scope: "read-only security advisor",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "pnpm supabase:advisor:security:strict: FAIL; inspect tmp\\safety-gate\\2026-10-03T08-41-37-508Z-91beea49\\security-advisor.log",
    evidence: ["tmp\\safety-gate\\2026-10-03T08-41-37-508Z-91beea49\\security-advisor.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for supabase:advisor:security:strict; external provider proof remains separate",
    ],
    category: "live_deployment",
  },
  {
    id: "performance-advisor",
    command: "pnpm supabase:advisor:performance",
    status: "WARN",
    scope: "read-only performance advisor",
    policy: "advisory; warnings visible",
    reason:
      "pnpm supabase:advisor:performance: WARN; inspect tmp\\safety-gate\\2026-10-03T08-52-26-991Z-d25d7ee7\\performance-advisor.log",
    evidence: ["tmp\\safety-gate\\2026-10-03T08-52-26-991Z-d25d7ee7\\performance-advisor.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for supabase:advisor:performance; external provider proof remains separate",
    ],
    category: "live_deployment",
  },
  {
    id: "deployment-ci",
    command: "pnpm exec tsx scripts/check-deployment-ci.ts",
    status: "UNAVAILABLE",
    scope: "read-only deployed commit/workflows",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "pnpm exec tsx scripts/check-deployment-ci.ts: UNAVAILABLE; inspect tmp\\safety-gate\\2026-10-03T09-13-08-356Z-89a8bb0b\\deployment-ci.log",
    evidence: ["tmp\\safety-gate\\2026-10-03T09-13-08-356Z-89a8bb0b\\deployment-ci.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for exec tsx scripts/check-deployment-ci.ts; external provider proof remains separate",
    ],
    category: "live_deployment",
  },
  {
    id: "deployment-health",
    command: "pnpm exec tsx scripts/check-deployment-health.ts",
    status: "PASS",
    scope: "read-only deployed health",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Executed successfully; scoped proof only",
    evidence: ["tmp\\safety-gate\\2026-10-03T08-41-37-508Z-91beea49\\deployment-health.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for exec tsx scripts/check-deployment-health.ts; external provider proof remains separate",
    ],
    category: "live_deployment",
  },
  {
    id: "lighthouse",
    command: "pnpm quality:lighthouse",
    status: "WARN",
    scope: "public accessibility/performance; advisory",
    policy: "advisory; warnings visible",
    reason: "Isolated synthetic deployment; scores are advisory.",
    evidence: ["tmp/isolated-browser/lighthouse.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["scripts/run-lighthouse.test.mjs", "lighthouse.config.json"],
    category: "repo_runtime",
  },
  {
    id: "performance",
    command: "pnpm test:perf",
    status: "UNAVAILABLE",
    scope: "staging HTTP latency/error budget",
    policy: "advisory; warnings visible",
    reason: "Requires dedicated staging load target; excluded from this read-only audit",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:perf; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "k6",
    command: "pnpm test:perf:k6",
    status: "UNAVAILABLE",
    scope: "advisory staging load",
    policy: "advisory; warnings visible",
    reason: "Requires separately approved staging load target; excluded from read-only audit",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:perf:k6; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "codeql",
    command: "Evidence required; no executable lane configured",
    status: "UNAVAILABLE",
    scope: "GitHub security-extended analysis",
    policy: "advisory; warnings visible",
    reason: "Local CodeQL unavailable; CI requires ENABLE_CODEQL and code-scanning access",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for GitHub security-extended analysis; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "ozow-delivery",
    command: "Evidence required; no executable lane configured",
    status: "UNAVAILABLE",
    scope: "genuine signed Ozow notification",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Genuine delivery not verified by fixtures or secret-name checks",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for genuine signed Ozow notification; external provider proof remains separate",
    ],
    category: "live_deployment",
  },
  {
    id: "email-dns",
    command: "pnpm email:domain:check",
    status: "WARN",
    scope: "public MX/SPF/DKIM/DMARC DNS; not inbox delivery",
    policy: "advisory; warnings visible",
    reason:
      "pnpm email:domain:check: WARN; inspect tmp\\safety-gate\\2026-10-03T08-52-26-991Z-d25d7ee7\\email-dns.log",
    evidence: ["tmp\\safety-gate\\2026-10-03T08-52-26-991Z-d25d7ee7\\email-dns.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for email:domain:check; external provider proof remains separate",
    ],
    category: "live_deployment",
  },
  {
    id: "http-smoke",
    command: "pnpm test:smoke",
    status: "UNAVAILABLE",
    scope: "public routes and rejected unauthenticated POSTs",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "POST probes must use an isolated test target; deployment deep health is the read-only check",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["src/__tests__/test-smoke-script.test.ts"],
    category: "repo_runtime",
  },
  {
    id: "dev-startup",
    command: "pnpm test:dev-startup",
    status: "UNAVAILABLE",
    scope: "local development startup and image-loader diagnostics",
    policy: "required; defect or incomplete blocks applicable scope",
    reason: "Excluded to preserve the active development server; production build is isolated",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:dev-startup; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "public-pages",
    command: "pnpm test:public-verify",
    status: "UNAVAILABLE",
    scope: "live public browser routes and Turnstile UI",
    policy: "advisory; warnings visible",
    reason:
      "Live browser may issue telemetry/challenge POSTs; excluded from strict read-only verification",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:public-verify; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "live-pages",
    command: "pnpm test:live-pages",
    status: "UNAVAILABLE",
    scope: "public/user/admin browser scenarios and boundaries",
    policy: "advisory; warnings visible",
    reason:
      "Live browser POSTs and authenticated sessions require a separate scoped run; requested skips now exit 2",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for test:live-pages; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "live-load",
    command: "pnpm security:audit:live-load:strict",
    status: "UNAVAILABLE",
    scope: "browser network payload/header/runtime observations",
    policy: "advisory; warnings visible",
    reason: "Live browser POST side effects are outside this read-only run; load testing excluded",
    evidence: [],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: [
      "scripts/audit-tooling.test.ts",
      "Implementation/configuration for security:audit:live-load:strict; external provider proof remains separate",
    ],
    category: "repo_runtime",
  },
  {
    id: "video-worker",
    command: "pnpm exec node scripts/test-video-worker.mjs",
    status: "PASS",
    scope: "emitted FFmpeg worker and self-hosted WASM",
    policy: "required; defect or incomplete blocks applicable scope",
    reason:
      "Actual emitted worker loaded self-hosted WASM and converted a synthetic MOV to MP4 (1964 bytes).",
    evidence: ["tmp/isolated-browser/video-worker.log"],
    exclusions: "Command configuration; external verification not implied",
    dependencies: ["pnpm frozen install"],
    tests: ["scripts/test-video-worker.mjs"],
    category: "repo_runtime",
  },
];
const backlog = [
  {
    priority: "P1",
    item: "braces 3.0.3 high-severity advisory GHSA-vfj7-8cjw-p6xm",
    owner: "Dependency maintainer",
    acceptance:
      "Adopt an upstream patched release or review a minimal depth-guard patch with adversarial regressions; strict all-dependency audit must pass. No patch was advertised at observation time.",
  },
  {
    priority: "P1",
    item: "Remotion custom/unknown licenses and Sentry FSL findings",
    owner: "Repository owner / license reviewer",
    acceptance:
      "Review actual package terms and deployment use. Document precise permitted versions and supporting evidence; do not approve Unknown globally.",
  },
  {
    priority: "P1",
    item: "17 Supabase security advisor observations",
    owner: "Database/security maintainer",
    acceptance:
      "Review three deny-by-default tables, 13 intentionally exposed definer-function grants and one plan-blocked password-protection finding. Verify final grants/RLS on isolated PostgreSQL before any separately authorized remote change.",
  },
  {
    priority: "P1",
    item: "Full migration PostgreSQL/PostgREST verification unavailable",
    owner: "CI / database maintainer",
    acceptance:
      "Run test:db:isolated with Docker; validate final migrations, RLS, grants and independent HTTP races. Extend real PostgreSQL fixtures for fulfillment/cancellation races; PGlite does not prove deployment or independent-session behavior.",
  },
  {
    priority: "P1",
    item: "Full Worker build/runtime bindings and prior credential artifact history",
    owner: "Cloudflare / security maintainer",
    acceptance:
      "Run the corrected build in an isolated Linux checkout, verify private settings arrive only through runtime bindings and examine prior artifact distribution. Any rotation requires encrypted-data recovery planning; no public exposure was established from the old local artifact.",
  },
  {
    priority: "P1",
    item: "Genuine signed Ozow delivery/signing-secret provenance unverified",
    owner: "Payments operator",
    acceptance:
      "Separately authorize a controlled provider test and retain delivery/signature evidence; OAuth payment-method access and synthetic Svix signatures cannot substitute.",
  },
  {
    priority: "P1",
    item: "Authenticated KYC browser submission/manual decisions not exercised",
    owner: "KYC/test maintainer",
    acceptance:
      "Expand isolated synthetic document and reviewer fixtures; test encryption/evidence access and high-risk decisions in Chromium, without customer documents.",
  },
  {
    priority: "P2",
    item: "Deployment commit/CI provenance unavailable",
    owner: "Release operator",
    acceptance:
      "Supply deployed SHA, repository and read token, then check exact successful main-push workflows.",
  },
  {
    priority: "P2",
    item: "CodeQL disabled/unavailable, quarantined WebKit/mobile Safari, full Firefox matrix not run",
    owner: "CI maintainer",
    acceptance:
      "Enable CodeQL with appropriate code-scanning access; stabilize quarantined browsers and execute full matrix. Keep missing coverage visible.",
  },
  {
    priority: "P2",
    item: "Advisory accessibility/performance, email DNS and index observations",
    owner: "Frontend / infrastructure maintainer",
    acceptance:
      "Review isolated Lighthouse evidence or resolve Chrome startup, DNS MX/DMARC warnings and performance advisor findings. Use a separately scoped staging load target for perf/k6.",
  },
  {
    priority: "P2",
    item: "Existing non-security debt and deferred major upgrades",
    owner: "Repository maintainer",
    acceptance:
      "Reduce exact lint/format/duplication baselines; independently plan Sentry, ESLint, Vite/Vitest, Svix, Tailwind and TypeScript major migrations. Refresh next-browser vendor snapshot through upstream installer, not hand edits.",
  },
];
export default function AuditInventory() {
  const theme = useHostTheme();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selected, setSelected] = useState(checks[0].id);
  const rows = checks.filter(
    (c) =>
      (status === "ALL" || c.status === status) &&
      `${c.id} ${c.command} ${c.scope}`.toLowerCase().includes(query.toLowerCase())
  );
  const detail = checks.find((c) => c.id === selected)!;
  return (
    <Stack gap={18} style={{ padding: 24, color: theme.text.primary, background: theme.bg.editor }}>
      <H1>VerifyMzansi audit inventory</H1>
      <Text tone="secondary">
        3 October 2026 · Commit a4a0c5f24f09 · Cross-run local and read-only evidence
      </Text>
      <Callout tone="warning">
        Release NO-GO. Security/license failures and required missing verification remain blocking.
        Browser KYC submission/reviewer coverage is incomplete.
      </Callout>
      <Grid columns={3}>
        <Stat label="Catalogued checks" value={checks.length} />
        <Stat label="Passing checks" value={checks.filter((c) => c.status === "PASS").length} />
        <Stat
          label="Incomplete checks"
          value={
            checks.filter((c) => ["UNAVAILABLE", "TIMED_OUT", "SKIPPED"].includes(c.status)).length
          }
        />
      </Grid>
      <Row gap={12}>
        <TextInput
          type="search"
          value={query}
          onChange={setQuery}
          placeholder="Find a command or scope"
        />
        <Select
          value={status}
          onChange={setStatus}
          options={["ALL", "PASS", "WARN", "FAIL", "UNAVAILABLE", "TIMED_OUT"].map((value) => ({
            value,
            label: value,
          }))}
        />
      </Row>
      <Grid columns="2fr 1fr" gap={20}>
        <Stack>
          <H2>Commands and evidence</H2>
          {rows.length > 0 && (
            <Table
              stickyHeader
              striped
              headers={["Check", "Result", "Policy", "Scope"]}
              rows={rows.map((c) => [
                <Button key={c.id} variant="ghost" onClick={() => setSelected(c.id)}>
                  {c.id}
                </Button>,
                c.status,
                c.policy,
                c.scope,
              ])}
            />
          )}
        </Stack>
        <Stack gap={10}>
          <H2>{detail.id}</H2>
          <Text>{detail.command}</Text>
          <Text weight="medium">
            {detail.status} · {detail.category}
          </Text>
          <Text>{detail.reason}</Text>
          <Text tone="secondary">Exclusions: {detail.exclusions}</Text>
          <Text tone="secondary">Prerequisites: {detail.dependencies.join(", ")}</Text>
          <Text tone="secondary">Regression references: {detail.tests.join(", ")}</Text>
          {detail.evidence.map((p) => (
            <Text key={p} size="small">
              {p}
            </Text>
          ))}
        </Stack>
      </Grid>
      <H2>Residual work, in priority order</H2>
      <Table
        headers={["Priority", "Work", "Owner", "Acceptance"]}
        rows={backlog.map((b) => [b.priority, b.item, b.owner, b.acceptance])}
      />
      <Text size="small" tone="secondary">
        Source: tracked audit-evidence-2026-10-03.json. PGlite is supplementary. Two desktop-only
        project skips passed on mobile. Provider fixtures do not verify genuine delivery; CodeQL and
        quarantined browsers are not inferred covered.
      </Text>
    </Stack>
  );
}
