import { defineConfig, devices } from "@playwright/test";
import { availableParallelism } from "node:os";

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || 3100);
const PLAYWRIGHT_HOST = process.env.PLAYWRIGHT_HOST || "127.0.0.1";
const PLAYWRIGHT_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || `http://${PLAYWRIGHT_HOST}:${PLAYWRIGHT_PORT}`;
const PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS = Number(
  process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS || 600_000
);

process.env.PLAYWRIGHT_TEST_MODE ||= "1";
process.env.PLAYWRIGHT_PORT ||= String(PLAYWRIGHT_PORT);
process.env.PLAYWRIGHT_HOST ||= PLAYWRIGHT_HOST;

export default defineConfig({
  testDir: "./e2e",
  // Foundation test copy specs run only with playwright.foundation.config.ts.
  testIgnore: ["**/foundation/**"],
  globalSetup: "./e2e/global.setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : Math.min(4, availableParallelism()),
  // The skip guard lists every skip and, in CI, fails on any that is not a
  // documented platform skip (e2e/support/skip-policy.ts).
  // PLAYWRIGHT_JSON_REPORT adds a JSON report (the visual job summarises it).
  reporter: [
    ["html"],
    ["./e2e/support/skip-guard-reporter.ts"],
    ...(process.env.PLAYWRIGHT_JSON_REPORT
      ? [["json", { outputFile: process.env.PLAYWRIGHT_JSON_REPORT }] as const]
      : []),
  ],
  timeout: process.env.CI ? 90_000 : 60_000,
  use: {
    baseURL: PLAYWRIGHT_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    navigationTimeout: process.env.CI ? 90_000 : 45_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], navigationTimeout: process.env.CI ? 120_000 : 45_000 },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], navigationTimeout: process.env.CI ? 120_000 : 45_000 },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],
  webServer: {
    command: "node scripts/start-playwright-server.cjs",
    // Preserve build diagnostics in isolated audit logs when startup fails.
    stdout: process.env.PLAYWRIGHT_CAPTURE_SERVER_OUTPUT === "1" ? "pipe" : "ignore",
    url: PLAYWRIGHT_BASE_URL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS,
  },
});
