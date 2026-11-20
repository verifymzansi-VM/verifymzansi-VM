import { defineConfig, devices } from "@playwright/test";
import foundation from "./playwright.foundation.config";

// Launch-configuration browser tests: the same private local test copy as
// playwright.foundation.config.ts, but built with every switch that hides a
// feature set to its launch value (LAUNCH_VALUES in src/lib/launch-config.ts:
// the src/lib/hidden-features.ts switches and PACKAGES_ON_SALE on, the
// pre-launch pop-up off), add-on sales open
// (LAUNCH_CONFIG_SETTINGS in scripts/lib/foundation-e2e-website.mjs). It runs
// every foundation spec plus launch-config.spec.ts, which visits each page
// behind a switch. Desktop Chromium only.
//
//   pnpm test:e2e:launch-config
//   node --import tsx scripts/foundation-e2e.mjs down     # delete the copy afterwards
//
// The build switch is accepted only for this local copy: next.config.js fails
// any other build that asks for it (scripts/lib/launch-config-build.cjs).
const LAUNCH_ENV = { VERIFYMZANSI_LAUNCH_CONFIG: "1" } as const;
// The specs read it too (launch-config.spec.ts refuses to run without it).
Object.assign(process.env, LAUNCH_ENV);

const webServer = Array.isArray(foundation.webServer)
  ? foundation.webServer[0]
  : foundation.webServer;
if (!webServer) throw new Error("The foundation config has no web server");

export default defineConfig({
  ...foundation,
  // Every foundation spec runs here, plus the launch-config smoke spec.
  testIgnore: "visual-regression.spec.ts",
  outputDir: "test-results/launch-config",
  reporter: [
    ["list"],
    ...(process.env.CI
      ? [["html", { open: "never", outputFolder: "playwright-report/launch-config" }] as const]
      : []),
    ["./e2e/support/skip-guard-reporter.ts"],
    ...(process.env.PLAYWRIGHT_JSON_REPORT
      ? [["json", { outputFile: process.env.PLAYWRIGHT_JSON_REPORT }] as const]
      : []),
  ],
  // Named "chromium" on purpose: several specs run their desktop checks only in
  // the project of that name (e2e/support/skip-policy.ts). The CI job is
  // "launch-config" (.github/workflows/e2e-launch-config.yml).
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { ...webServer, env: { ...webServer.env, ...LAUNCH_ENV } },
});
