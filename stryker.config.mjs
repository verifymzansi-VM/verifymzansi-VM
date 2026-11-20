/**
 * Mutation-testing trial (launch checklist item 43): StrykerJS changes small
 * pieces of a few critical modules and checks that a test fails each time.
 * Run it with `pnpm test:mutation`; it is not part of CI. Results and the
 * reasoning behind the chosen modules: docs/testing/mutation-trial.md.
 */
const config = {
  testRunner: "vitest",
  vitest: { configFile: "vitest.mutation.config.ts", related: false },
  mutate: [
    // The person-name rule (display and legal names).
    "src/lib/foundation/person-name.ts",
    // The origin and double-submit token checks on every state-changing route.
    "src/lib/utils/mutation-origin.ts",
    "src/lib/utils/csrf-client.ts",
    // Rate limiter keys for typed values such as email addresses.
    "src/lib/foundation/limiter-key.ts",
  ],
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "tmp/mutation/index.html" },
  jsonReporter: { fileName: "tmp/mutation/mutation.json" },
  tempDirName: "tmp/stryker",
  // Root folders the tests never read (anchored: src/lib/supabase is needed).
  ignorePatterns: [
    "/public",
    "/remotion",
    "/e2e",
    "/output",
    "/infra",
    "/supabase",
    "/storybook-static",
    "/.next",
    "/.open-next",
    "/coverage",
    "/tmp",
  ],
  concurrency: 4,
  timeoutMS: 20000,
  cleanTempDir: "always",
};

export default config;
