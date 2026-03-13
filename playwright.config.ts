import { defineConfig, devices } from "@playwright/test";

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT || 3100);
const PLAYWRIGHT_HOST = process.env.PLAYWRIGHT_HOST || "127.0.0.1";
const PLAYWRIGHT_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || `http://${PLAYWRIGHT_HOST}:${PLAYWRIGHT_PORT}`;

process.env.PLAYWRIGHT_TEST_MODE ||= "1";
process.env.PLAYWRIGHT_PORT ||= String(PLAYWRIGHT_PORT);
process.env.PLAYWRIGHT_HOST ||= PLAYWRIGHT_HOST;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
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
    url: PLAYWRIGHT_BASE_URL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 180 * 1000,
  },
});
