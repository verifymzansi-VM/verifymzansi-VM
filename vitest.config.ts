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
      thresholds: {
        statements: strictCoverage ? 60 : 55,
        branches: strictCoverage ? 50 : 40,
        functions: strictCoverage ? 55 : 45,
        lines: strictCoverage ? 60 : 55,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
