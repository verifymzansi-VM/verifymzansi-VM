import { defineConfig, devices } from "@playwright/test";
import { E2E_FIXTURE } from "./scripts/lib/foundation-e2e-target.mjs";

// Picture checks of the chosen frontend (e2e/foundation/visual-regression.spec.ts)
// against the private local foundation test copy. Do not run this config
// directly: scripts/foundation-visual.mjs starts the copy's website on the
// host and then runs this config inside the pinned Playwright image (same
// browser build and fonts as the approved pictures), sharing the host network.
//
// Unlike playwright.foundation.config.ts there is no web server and no global
// setup here: both need Docker and the Supabase CLI, which exist on the host,
// not inside the browser image. The host script proves the copy (loopback
// stack, schema fingerprint, seeded posts, copy build) before this runs.
const baseURL = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;

export default defineConfig({
  testDir: "./e2e/foundation",
  testMatch: "visual-regression.spec.ts",
  outputDir: "test-results/visual",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: [
    ["list"],
    ...(process.env.CI
      ? [["html", { open: "never", outputFolder: "playwright-report/visual" }] as const]
      : []),
    ...(process.env.PLAYWRIGHT_JSON_REPORT
      ? [["json", { outputFile: process.env.PLAYWRIGHT_JSON_REPORT }] as const]
      : []),
  ],
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    navigationTimeout: 45_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
