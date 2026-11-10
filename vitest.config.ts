import { configDefaults, defineConfig } from "vitest/config";
import path from "path";
import react from "@vitejs/plugin-react";
import { availableParallelism } from "node:os";
import { LEGACY_BACKEND_SUITES } from "./src/test/legacy-backend-suites";
import { COVERAGE_EXCLUDED_SUITES } from "./src/test/coverage-excluded-suites";

const strictCoverage = process.env.STRICT_COVERAGE === "true";
const vitestLane = process.env.VITEST_LANE ?? "blocking";
const coverageCoreLane = vitestLane === "coverage-core";
// Runs only the suites the coverage lane leaves out, so CI runs every unit
// test once: coverage-core plus coverage-excluded equals the blocking lane.
const coverageExcludedLane = vitestLane === "coverage-excluded";
// Test file paths contain glob characters such as [id] and (marketplace).
const literalGlob = (file: string) => file.replace(/[[\]()]/g, (char) => `\\${char}`);
const coverageExcludedGlobs = COVERAGE_EXCLUDED_SUITES.map(literalGlob);
const laneExclude = coverageCoreLane
  ? [...configDefaults.exclude, ...coverageExcludedGlobs]
  : configDefaults.exclude;
const legacyBackendGlobs = LEGACY_BACKEND_SUITES.map(literalGlob);
const foundationInclude = coverageExcludedLane
  ? coverageExcludedGlobs
  : ["src/**/*.{test,spec}.{ts,tsx}"];
// An empty include list would not mean "no files", so name a path that cannot
// exist when no excluded suite is a legacy one.
const legacyExcludedGlobs = legacyBackendGlobs.filter((glob) =>
  coverageExcludedGlobs.includes(glob)
);
const legacyInclude = coverageExcludedLane
  ? legacyExcludedGlobs.length > 0
    ? legacyExcludedGlobs
    : ["src/__no-legacy-coverage-excluded-suite__.test.ts"]
  : legacyBackendGlobs;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Unit tests must never inherit the workstation's production database.
    // Tests of production detection explicitly stub their target/settings.
    env: {
      // Production runs foundation, so new tests do too. Old-backend suites are
      // listed in src/test/legacy-backend-suites.ts and run in their own project.
      NEXT_PUBLIC_DATA_BACKEND: "foundation",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-public-anon",
      ENVIRONMENT: "test",
    },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Avoid exhausting memory when the runner sees many logical CPUs.
    maxWorkers: Math.min(4, availableParallelism()),
    testTimeout: 10000,
    // V8 instrumentation makes cold WASM database setup slower than assertions.
    // Keep coverage setup bounded without changing the assertion deadline.
    hookTimeout: coverageCoreLane ? 30_000 : 10_000,
    // include/exclude are set per project only: a project's arrays are merged
    // with (not replaced by) the root's.
    projects: [
      {
        extends: true,
        test: {
          name: "foundation",
          include: foundationInclude,
          exclude: [...laneExclude, ...legacyBackendGlobs],
          env: { NEXT_PUBLIC_DATA_BACKEND: "foundation" },
        },
      },
      {
        extends: true,
        test: {
          name: "legacy-backend",
          include: legacyInclude,
          exclude: laneExclude,
          env: { NEXT_PUBLIC_DATA_BACKEND: "source" },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/app/api/**", "src/hooks/**", "src/stores/**"],
      exclude: [
        // Generated OpenAPI declarations are type-only and non-executable.
        "src/lib/api/v1.d.ts",
        // Barrel files only re-export symbols and don't contain runtime logic.
        "src/lib/validations/index.ts",
        "src/lib/services/index.ts",
        "src/stores/index.ts",
        // Playwright E2E infrastructure — imports `server-only`, runs only in E2E context
        "src/lib/supabase/playwright-stub.ts",
        "src/lib/supabase/playwright-fixture-store.ts",
        "src/lib/supabase/playwright-session.ts",
        "src/lib/supabase/playwright-visual-fixtures.ts",
        // Next.js server-only runtime — imports `server-only` + `next/headers`, can't run in jsdom
        "src/lib/supabase/server.ts",
        // Browser Supabase client — requires real Supabase credentials; always fully mocked in every unit test
        "src/lib/supabase/client.ts",
        // Pure TypeScript interface file — no executable code or branches to measure
        "src/lib/services/kyc-provider-interface.ts",
      ],
      thresholds: {
        statements: strictCoverage ? 75 : 74,
        branches: strictCoverage ? 64 : 63,
        functions: strictCoverage ? 82 : 81,
        lines: strictCoverage ? 76 : 75,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
