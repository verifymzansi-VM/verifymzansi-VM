import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; if?: string; run?: string };
type Job = { name?: string; if?: string; needs?: string | string[]; steps: Step[] };

const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
  jobs: Record<string, Job>;
};

describe("CI reports what it ran", () => {
  it("skips the staging load checks at job level when no staging address exists", () => {
    const config = ci.jobs["staging-config"];
    expect(config.steps.map((step) => step.run ?? "").join("\n")).toContain("configured=false");
    for (const id of ["perf-baseline", "k6-advisory"]) {
      const job = ci.jobs[id];
      // A job-level condition gives a real "skipped" state; a step that echoes
      // and exits 0 reports success without measuring anything.
      expect(job.if).toContain("needs.staging-config.outputs.configured == 'true'");
      expect([job.needs].flat()).toContain("staging-config");
      for (const step of job.steps) {
        expect(step.if ?? "").not.toContain("check-url");
        expect(step.run ?? "").not.toMatch(/not set, skipping/i);
      }
    }
  });

  it("labels the dry-run safety gate as a plan that runs no checks", () => {
    const job = ci.jobs["safety-gate-snapshot"];
    expect(job.name).toContain("plan only (runs no checks)");
    expect(job.steps.map((step) => step.run ?? "").join("\n")).toContain("--dry-run");
  });

  it("fails browser runs in CI on skips that are not documented platform skips", () => {
    const config = readFileSync("playwright.config.ts", "utf8");
    expect(config).toContain("./e2e/support/skip-guard-reporter.ts");
    const reporter = readFileSync("e2e/support/skip-guard-reporter.ts", "utf8");
    expect(reporter).toContain('return { status: "failed" }');
    for (const job of ["e2e-smoke", "e2e-full-matrix"]) {
      const run = ci.jobs[job].steps.map((step) => step.run ?? "").join("\n");
      // A command-line --reporter would replace the configured skip guard.
      expect(run).toContain("playwright test");
      expect(run).not.toContain("--reporter");
      expect(JSON.stringify(ci.jobs[job])).not.toContain("PLAYWRIGHT_SKIP_GUARD");
    }
  });
});
