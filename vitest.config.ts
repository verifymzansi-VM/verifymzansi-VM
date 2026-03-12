import { defineConfig } from "vitest/config";
import path from "path";
import react from "@vitejs/plugin-react";

const strictCoverage = process.env.STRICT_COVERAGE === "true";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**",
        "src/app/api/**",
        "src/components/**",
        "src/hooks/**",
        "src/stores/**",
      ],
      thresholds: {
        statements: strictCoverage ? 55 : 55,
        branches: strictCoverage ? 40 : 40,
        functions: strictCoverage ? 45 : 45,
        lines: strictCoverage ? 55 : 55,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
