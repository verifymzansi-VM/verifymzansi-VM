import { configDefaults, defineConfig } from "vitest/config";
import path from "path";
import react from "@vitejs/plugin-react";

const strictCoverage = process.env.STRICT_COVERAGE === "true";
const vitestLane = process.env.VITEST_LANE ?? "blocking";
const coverageCoreLane = vitestLane === "coverage-core";
const coverageSensitiveTests = [
  "src/components/listings/business-category-strip.test.tsx",
  "src/app/(marketplace)/mzansi-business/discovery-bar.test.tsx",
  "src/app/post/create-business/page.test.tsx",
  "src/app/dsar/page.test.tsx",
  "src/app/verification/page.test.tsx",
  "src/app/post/edit-listing/[id]/page.test.tsx",
];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 10000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: coverageCoreLane
      ? [...configDefaults.exclude, ...coverageSensitiveTests]
      : configDefaults.exclude,
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/app/api/**", "src/hooks/**", "src/stores/**"],
      exclude: [
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
        statements: strictCoverage ? 65 : 60,
        branches: strictCoverage ? 59 : 50,
        functions: strictCoverage ? 60 : 50,
        lines: strictCoverage ? 65 : 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
