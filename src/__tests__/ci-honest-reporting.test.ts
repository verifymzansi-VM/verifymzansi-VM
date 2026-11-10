import { readdirSync, readFileSync } from "node:fs";
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

  it("has no job whose only check is a dry-run plan", () => {
    // A job that only lists the safety gate's checks turns green without
    // checking anything. audit-tooling-platforms also runs the tooling tests.
    for (const [id, job] of Object.entries(ci.jobs)) {
      const runs = job.steps.map((step) => step.run ?? "").filter(Boolean);
      if (runs.some((run) => run.includes("--dry-run")))
        expect(
          runs.some((run) => run.includes("pnpm test:tooling")),
          id
        ).toBe(true);
    }
  });

  it("builds the Worker once and keeps its runtime proof", () => {
    const builds = Object.entries(ci.jobs).filter(([, job]) =>
      job.steps.some((step) => (step.run ?? "").includes("build:cloudflare"))
    );
    expect(builds.map(([id]) => id)).toEqual(["build-route-verify"]);
    const steps = ci.jobs["build-route-verify"].steps as (Step & {
      uses?: string;
      with?: Record<string, string | boolean>;
    })[];
    const startup = steps.findIndex((step) => step.run === "pnpm test:cloudflare:startup");
    const proof = steps.findIndex((step) => step.with?.name === "foundation-worker-runtime");
    expect(startup).toBeGreaterThan(-1);
    expect(proof).toBeGreaterThan(startup);
    expect(steps[proof].if).toBe("always()");
    expect(steps[proof].with?.["include-hidden-files"]).toBe(true);
    expect(steps[proof].with?.path).toContain("tmp/cloudflare-runtime/latest.json");
    expect(steps[proof].with?.path).toContain(".open-next/build-fingerprint.json");
  });

  it("runs the tooling tests once per operating system", () => {
    const tooling = Object.entries(ci.jobs).filter(([, job]) =>
      job.steps.some((step) => /pnpm test:tooling|--checks=[^\s]*\btooling\b/.test(step.run ?? ""))
    );
    expect(tooling.map(([id]) => id)).toEqual(["audit-tooling-platforms"]);
    const platforms = (
      ci.jobs["audit-tooling-platforms"] as Job & { strategy: { matrix: { os: string[] } } }
    ).strategy.matrix.os;
    expect(platforms).toEqual(["ubuntu-latest", "windows-latest"]);
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

describe("production-matching suites on main and the failure alert", () => {
  type Workflow = {
    name: string;
    on: Record<string, unknown>;
    concurrency?: { group: string; "cancel-in-progress": string | boolean };
    permissions?: Record<string, string>;
    jobs: Record<
      string,
      Job & {
        permissions?: Record<string, string>;
        steps: (Step & { uses?: string })[];
      }
    >;
  };
  const load = (file: string) =>
    parse(readFileSync(`.github/workflows/${file}`, "utf8")) as Workflow;
  const files = readdirSync(".github/workflows").filter((file) => file.endsWith(".yml"));

  it("runs foundation-native and e2e-foundation on every push to main, never cancelling a main run", () => {
    for (const file of ["foundation-native.yml", "e2e-foundation.yml"]) {
      const workflow = load(file);
      expect(workflow.on.push, file).toEqual({ branches: ["main"] });
      expect(workflow.on.pull_request, file).toEqual({ branches: ["main"] });
      expect(workflow.concurrency?.group, file).toContain("github.event.pull_request.number ||");
      expect(workflow.concurrency?.group, file).toContain("github.sha");
      expect(workflow.concurrency?.group, file).not.toContain("github.ref");
      expect(workflow.concurrency?.["cancel-in-progress"], file).toBe(
        "${{ github.event_name == 'pull_request' }}"
      );
      // Separate runs: CI does not call them, so they stay outside the deploy gate.
      expect(readFileSync(".github/workflows/ci.yml", "utf8")).not.toContain(file);
    }
    const deploy = load("deploy.yml").on.workflow_run as { workflows: string[] };
    expect(deploy.workflows).toEqual(["CI"]);
  });

  it("names the failed native checks from the redacted results when the suite fails", () => {
    const steps = load("foundation-native.yml").jobs["foundation-native"].steps;
    const tests = steps.findIndex((step) => step.run === "pnpm test:foundation:native");
    const summary = steps.findIndex((step) =>
      (step.run ?? "").includes("scripts/foundation-native-failure-summary.mjs")
    );
    expect(summary).toBeGreaterThan(tests);
    expect(steps[summary].if).toBe("failure() && steps.scope.outputs.run == 'true'");
    const upload = steps.find((step) => step.name === "Preserve the redacted native results");
    expect(upload?.if).toBe("always() && steps.scope.outputs.run == 'true'");
  });

  it("alerts on a failed main or scheduled run of every workflow that has one", () => {
    const alert = load("failure-alert.yml");
    const watched = (alert.on.workflow_run as { workflows: string[]; types: string[] }).workflows;
    expect((alert.on.workflow_run as { types: string[] }).types).toEqual(["completed"]);
    for (const file of files.filter((name) => name !== "failure-alert.yml")) {
      const workflow = load(file);
      const push = workflow.on.push as { branches?: string[] } | undefined;
      const unattended =
        "schedule" in workflow.on ||
        "workflow_run" in workflow.on ||
        push?.branches?.includes("main");
      if (unattended) expect(watched, file).toContain(workflow.name);
    }
    for (const name of watched)
      expect(
        files.some((file) => load(file).name === name),
        name
      ).toBe(true);

    const job = alert.jobs.alert;
    expect(job.if).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(job.if).toContain("github.event.workflow_run.event == 'schedule'");
    expect(job.if).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(job.if).not.toContain("pull_request");
    expect(alert.permissions).toEqual({});
    expect(job.permissions).toEqual({ issues: "write" });
    // No code from the failed run is checked out or executed, and no event
    // value is pasted into the script (all arrive through env).
    for (const step of job.steps) {
      expect(step.uses).toBeUndefined();
      expect(step.run ?? "").not.toContain("${{");
    }
  });
});
