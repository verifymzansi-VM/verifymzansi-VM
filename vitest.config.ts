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
        statements: strictCoverage ? 45 : 40,
        branches: strictCoverage ? 30 : 25,
        functions: strictCoverage ? 35 : 30,
        lines: strictCoverage ? 45 : 40,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
