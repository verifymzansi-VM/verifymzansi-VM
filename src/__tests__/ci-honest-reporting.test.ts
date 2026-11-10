import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
};
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

describe("CI job graph", () => {
  const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
    concurrency: { group: string; "cancel-in-progress": string };
    jobs: Record<string, Job & { "timeout-minutes"?: number }>;
  };

  it("lets browser jobs start after the static checks instead of waiting for unit tests", () => {
    // They use nothing the unit or build jobs produce. Every job stays a
    // required check, so a merge still needs all of them green.
    for (const id of ["e2e-smoke", "launch-flows-bundle", "e2e-full-matrix"])
      expect([workflow.jobs[id].needs].flat(), id).toEqual(["lint-type-security"]);
  });

  it("cancels superseded pull request runs but never a run on main", () => {
    expect(workflow.concurrency.group).toBe(
      "ci-${{ github.event.pull_request.number || github.sha }}"
    );
    expect(workflow.concurrency["cancel-in-progress"]).toBe(
      "${{ github.event_name == 'pull_request' }}"
    );
  });

  it("gives every job a time limit instead of the six-hour default", () => {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      const limit = job["timeout-minutes"];
      expect(typeof limit, id).toBe("number");
      expect(limit, id).toBeGreaterThan(0);
      expect(limit, id).toBeLessThanOrEqual(45);
    }
  });

  it("counts tests that passed only on retry in each browser job's summary", () => {
    for (const id of ["e2e-smoke", "e2e-full-matrix"]) {
      const steps = workflow.jobs[id].steps;
      const run = steps.findIndex((step) => (step.run ?? "").includes("playwright test"));
      const report = steps[run].env?.PLAYWRIGHT_JSON_REPORT ?? "";
      expect(report, id).toMatch(/^test-results\/.+\$\{\{ matrix\.project \}\}\.json$/);
      const summary = steps
        .slice(run + 1)
        .find((step) => (step.run ?? "").includes("scripts/e2e-foundation-summary.mjs"));
      expect(summary?.if, id).toBe("always()");
      expect(summary?.run, id).toContain('"$GITHUB_STEP_SUMMARY"');
    }
  });
});

describe("scheduled monitoring reports what it checked", () => {
  const load = (name: string) =>
    parse(readFileSync(`.github/workflows/${name}.yml`, "utf8")) as {
      jobs: Record<string, Job>;
    };

  it("has no synthetic monitoring step that turns green without checking", () => {
    const monitoring = load("synthetic-monitoring");
    // The old worker-health job echoed "skipping" and exited 0 when its URLs
    // were unset, so it always reported success while checking nothing.
    expect(Object.keys(monitoring.jobs)).toEqual(["production-smoke"]);
    expect(monitoring.jobs["production-smoke"].if).toBeUndefined();
    const steps = monitoring.jobs["production-smoke"].steps;
    for (const step of steps) {
      expect(step.if).toBeUndefined();
      expect(step["continue-on-error"]).toBeUndefined();
      expect(step.run ?? "").not.toMatch(/skipping|skip=true|exit 0|\|\| true/i);
    }
    const runs = steps.map((step) => step.run ?? "").join("\n");
    expect(runs).toContain("exit 1");
    expect(runs).toContain("scripts/check-public-edge.ts");
    expect(runs).toContain("scripts/check-site-monitor.ts");
  });

  it("pings the backup heartbeat last, only after the upload, and never fails the backup", () => {
    const job = load("database-backup").jobs.backup;
    const steps = job.steps;
    // Every earlier step must be able to stop the run before the heartbeat.
    expect(job.if).toBeUndefined();
    for (const step of steps.slice(0, -1)) {
      expect(step.if).toBeUndefined();
      expect(step["continue-on-error"]).toBeUndefined();
      expect(step.run ?? "").not.toMatch(/\|\| true/);
    }
    expect(steps.find((step) => step.name === "Encrypt the backup")!.run).toContain(
      "set -o pipefail"
    );
    const heartbeat = steps.at(-1)!;
    expect(steps.at(-2)!.name).toBe("Upload to the private R2 bucket");
    // No `if:` means it runs only when every earlier step succeeded.
    expect(heartbeat.if).toBeUndefined();
    expect(heartbeat["continue-on-error"]).toBe(true);
    expect(heartbeat.env).toEqual({
      HEARTBEAT_URL: "${{ secrets.HEARTBEAT_URL_DATABASE_BACKUP }}",
    });
    expect(heartbeat.run).toContain('if [ -z "$HEARTBEAT_URL" ]');
    expect(heartbeat.run).toContain("--max-time 10");
    expect(heartbeat.run).toContain("--proto '=https'");
    // The URL is the credential: it is passed to curl only, never echoed.
    expect(heartbeat.run).not.toMatch(/echo[^\n]*HEARTBEAT_URL/);
    expect(heartbeat.run).not.toMatch(/set -x|--verbose|-v /);
  });
});
