import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
};
// Jobs that call another workflow (`uses:`) have no steps of their own.
type Job = { name?: string; if?: string; needs?: string | string[]; uses?: string; steps: Step[] };

// A draft pull request (without the run-full-ci label) skips the slow lanes,
// which then report under a name that is never required
// (docs/branch-protection.md, "Draft pull requests"). The condition starts
// with the pull_request event, so it can never skip a main or manual run.
const DRAFT_CONDITION =
  "github.event_name == 'pull_request' && github.event.pull_request.draft && !contains(github.event.pull_request.labels.*.name, 'run-full-ci')";
const draftRenamed = (check: string) =>
  `\${{ (${DRAFT_CONDITION}) && '${check} (draft, not run)' || '${check}' }}`;

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
      const runs = (job.steps ?? []).map((step) => step.run ?? "").filter(Boolean);
      if (runs.some((run) => run.includes("--dry-run")))
        expect(
          runs.some((run) => run.includes("pnpm test:tooling")),
          id
        ).toBe(true);
    }
  });

  it("builds the Worker once and keeps its runtime proof", () => {
    const builds = Object.entries(ci.jobs).filter(([, job]) =>
      (job.steps ?? []).some((step) => (step.run ?? "").includes("build:cloudflare"))
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
      (job.steps ?? []).some((step) =>
        /pnpm test:tooling|--checks=[^\s]*\btooling\b/.test(step.run ?? "")
      )
    );
    expect(tooling.map(([id]) => id)).toEqual(["audit-tooling-platforms"]);
    const platforms = (
      ci.jobs["audit-tooling-platforms"] as Job & { strategy: { matrix: { os: string[] } } }
    ).strategy.matrix.os;
    expect(platforms).toEqual(["ubuntu-latest", "windows-latest"]);
  });

  it("fails browser runs in CI on skips that are not documented platform skips", () => {
    const config = readFileSync("playwright.foundation.config.ts", "utf8");
    expect(config).toContain("./e2e/support/skip-guard-reporter.ts");
    const reporter = readFileSync("e2e/support/skip-guard-reporter.ts", "utf8");
    expect(reporter).toContain('return { status: "failed" }');
    const browser = (
      parse(readFileSync(".github/workflows/e2e-foundation.yml", "utf8")) as {
        jobs: Record<string, Job>;
      }
    ).jobs.browser;
    const run = browser.steps.map((step) => step.run ?? "").join("\n");
    // A command-line --reporter would replace the configured skip guard.
    expect(run).toContain("playwright test --config=playwright.foundation.config.ts");
    expect(run).not.toContain("--reporter");
    expect(JSON.stringify(browser)).not.toContain("PLAYWRIGHT_SKIP_GUARD");
  });
});

describe("CI job graph", () => {
  const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
    concurrency: { group: string; "cancel-in-progress": string };
    jobs: Record<string, Job & { "timeout-minutes"?: number }>;
  };

  it("has no job of the retired stub browser suite", () => {
    // e2e-foundation (its own workflow) is the browser check; the pictures
    // build their own site for the foundation test copy.
    for (const id of ["e2e-full-matrix", "build-e2e"])
      expect(workflow.jobs[id], id).toBeUndefined();
    const text = readFileSync(".github/workflows/ci.yml", "utf8");
    for (const retired of [
      "start-playwright-server",
      "check-kyc-browser-report",
      "PLAYWRIGHT_TEST_MODE",
      "download-artifact",
    ])
      expect(text, retired).not.toContain(retired);
  });

  it("compares the pictures on the foundation test copy in the pinned browser image", () => {
    const job = workflow.jobs["visual-regression"] as Job & {
      "runs-on"?: string;
      container?: unknown;
    };
    // The required check's name must not change.
    expect(job.name).toBe("Visual regression (chosen frontend)");
    // The test copy needs the runner's Docker: no job container.
    expect(job.container).toBeUndefined();
    expect(job["runs-on"]).toBe("ubuntu-latest");
    const runs = job.steps.map((step) => step.run ?? "");
    const at = (command: string) => runs.findIndex((run) => run.includes(command));
    expect(at("scripts/foundation-e2e.mjs up")).toBeGreaterThan(-1);
    expect(at("scripts/foundation-e2e.mjs build")).toBeGreaterThan(
      at("scripts/foundation-e2e.mjs up")
    );
    expect(at("scripts/foundation-visual.mjs --retries=1")).toBeGreaterThan(
      at("scripts/foundation-e2e.mjs build")
    );
    const down = job.steps.find((step) => (step.run ?? "").includes("foundation-e2e.mjs down"));
    expect(down?.if).toBe("always()");
    // Nothing of the retired backend or its in-memory stub.
    const text = JSON.stringify(job);
    for (const retired of [
      "start-playwright-server",
      "placeholder.supabase.co",
      "PLAYWRIGHT_TEST_MODE",
      "e2e/visual-regression.spec.ts",
    ])
      expect(text).not.toContain(retired);

    // The browser image is pinned by digest in one place, and its Playwright
    // is the installed one (a mismatch would draw with another browser build).
    const script = readFileSync("scripts/foundation-visual.mjs", "utf8");
    const image = /"mcr\.microsoft\.com\/playwright:v([\d.]+)-noble@sha256:[0-9a-f]{64}"/.exec(
      script
    );
    const installed = JSON.parse(
      readFileSync("node_modules/@playwright/test/package.json", "utf8")
    ) as { version: string };
    expect(image?.[1]).toBe(installed.version);
    expect(script).toContain('"--network",\n    "host"');

    // New pictures are made the same way, into the foundation spec's folder.
    const update = parse(readFileSync(".github/workflows/update-visual-baselines.yml", "utf8")) as {
      jobs: Record<string, Job & { container?: unknown }>;
    };
    const generate = update.jobs["generate-baselines"];
    expect(generate.container).toBeUndefined();
    const updateRuns = generate.steps.map((step) => step.run ?? "").join("\n");
    expect(updateRuns).toContain("scripts/foundation-e2e.mjs up");
    expect(updateRuns).toContain("scripts/foundation-visual.mjs --update-snapshots=changed");
    expect(updateRuns).toContain(
      'git add "e2e/foundation/visual-regression.spec.ts-snapshots/*-chromium-linux.png"'
    );
  });

  it("runs Lighthouse on the bundle-analysis build, as an advisory step", () => {
    expect(workflow.jobs["lighthouse-advisory"]).toBeUndefined();
    const steps = workflow.jobs["bundle-analysis"].steps;
    const budget = steps.findIndex((step) => step.run === "pnpm run check:bundle-budget");
    const audit = steps.findIndex((step) => step.run === "pnpm run quality:lighthouse");
    expect(audit).toBeGreaterThan(budget);
    expect(budget).toBeGreaterThan(-1);
    expect(steps[audit]["continue-on-error"]).toBe(true);
    expect(steps[budget]["continue-on-error"]).toBeUndefined();
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
      // A job calling another workflow cannot set its own limit; every job of
      // the called workflow must (the native suite may take up to an hour).
      if (job.uses) {
        const called = parse(readFileSync(job.uses.replace(/^\.\//, ""), "utf8")) as {
          jobs: Record<string, { "timeout-minutes"?: number }>;
        };
        for (const [calledId, calledJob] of Object.entries(called.jobs)) {
          expect(typeof calledJob["timeout-minutes"], `${id} / ${calledId}`).toBe("number");
          expect(calledJob["timeout-minutes"], `${id} / ${calledId}`).toBeLessThanOrEqual(60);
        }
        continue;
      }
      const limit = job["timeout-minutes"];
      expect(typeof limit, id).toBe("number");
      expect(limit, id).toBeGreaterThan(0);
      expect(limit, id).toBeLessThanOrEqual(45);
    }
  });

  it("keeps the checks only the removed launch-flows job made", () => {
    const build = workflow.jobs["build-route-verify"].steps;
    const built = build.findIndex((step) => step.run === "pnpm run build:cloudflare");
    const routes = build.findIndex((step) => step.run === "node scripts/check-built-routes.mjs");
    expect(built).toBeGreaterThan(-1);
    expect(routes).toBeGreaterThan(built);
    expect(build[routes].if).toBeUndefined();
    expect(Object.keys(workflow.jobs)).not.toEqual(
      expect.arrayContaining(["e2e-smoke", "launch-flows-bundle"])
    );
  });

  it("counts tests that passed only on retry in each browser job's summary", () => {
    const e2e = parse(readFileSync(".github/workflows/e2e-foundation.yml", "utf8")) as {
      jobs: Record<string, Job & { strategy?: { matrix: { project: string[] } } }>;
    };
    const browser = e2e.jobs.browser;
    expect(browser.strategy?.matrix.project).toEqual(["chromium", "mobile-chrome"]);
    const steps = browser.steps;
    const run = steps.findIndex((step) => (step.run ?? "").includes("playwright test"));
    expect(steps[run].env?.PLAYWRIGHT_JSON_REPORT).toBe(
      "test-results/foundation-${{ matrix.project }}.json"
    );
    const summary = steps
      .slice(run + 1)
      .find((step) => (step.run ?? "").includes("scripts/e2e-foundation-summary.mjs"));
    expect(summary?.if).toBe("always()");
    expect(summary?.run).toContain('"$GITHUB_STEP_SUMMARY"');
    // The required aggregate check fails unless every browser project passed.
    // Outside a draft it reports as e2e-foundation, the required check.
    const aggregate = e2e.jobs["e2e-foundation"];
    expect(aggregate.name).toBe(draftRenamed("e2e-foundation"));
    expect(DRAFT_CONDITION.startsWith("github.event_name == 'pull_request' && ")).toBe(true);
    expect(aggregate.needs).toBe("browser");
    expect(aggregate.if).toBe("${{ !cancelled() }}");
    expect(aggregate.steps.map((step) => step.run ?? "").join("\n")).toContain(
      'if [ "$RESULT" != "success" ]'
    );
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
      // Only the cleanup that deletes the connection string runs regardless;
      // it cannot fail, and the heartbeat still needs every step to succeed.
      if (step.name === "Forget the connection string") {
        expect(step.if).toBe("always()");
        expect(step.run).toBe('rm -f "$RUNNER_TEMP/db-url"');
        continue;
      }
      expect(step.if).toBeUndefined();
      expect(step["continue-on-error"]).toBeUndefined();
      expect(step.run ?? "").not.toMatch(/\|\| true/);
    }
    expect(steps.find((step) => step.name === "Encrypt the backup")!.run).toContain(
      "set -o pipefail"
    );
    const heartbeat = steps.at(-1)!;
    // A part that could not be captured fails the run after the upload, so
    // the usable backup is stored and the heartbeat still stays silent.
    expect(steps.at(-3)!.name).toBe("Upload to the private R2 bucket");
    const missing = steps.at(-2)!;
    expect(missing.name).toBe("Fail if part of the backup is missing");
    expect(missing.run).toContain("problems.txt");
    expect(missing.run).toContain("exit 1");
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

  it("backs up the platform schemas and a count-only manifest inside the encrypted archive", () => {
    const workflow = parse(readFileSync(".github/workflows/database-backup.yml", "utf8")) as {
      on: { schedule: { cron: string }[] };
      jobs: Record<string, Job & { env: Record<string, string> }>;
    };
    const job = workflow.jobs.backup;
    const step = (name: string) => job.steps.find((candidate) => candidate.name === name)!.run!;
    // The main files keep their schemas; the platform schemas get their own.
    expect(job.env.BACKUP_SCHEMAS).toBe("api,private,internal,public,auth,extensions");
    expect(job.env.PLATFORM_SCHEMAS).toBe("realtime,supabase_migrations");
    const platform = step("Dump the Supabase platform schemas");
    expect(platform).toContain('--schema "$PLATFORM_SCHEMAS" -f platform-schema.sql');
    expect(platform).toContain('"owner_inbox_receive" ON "realtime"');
    // Only the migration ledger's rows: realtime rows are transient.
    expect(platform).toContain(
      "--schema supabase_migrations -f platform-data.sql --use-copy --data-only"
    );
    expect(platform).toContain(">> problems.txt");

    const countsStep = job.steps.find(
      (candidate) => candidate.name === "Record row counts and the schema fingerprint"
    )!;
    expect(countsStep.env?.PGSSLMODE).toBe("require");
    expect(countsStep.env?.PGCONNECT_TIMEOUT).toBe("15");
    // The extras are capped so they cannot use up the job before the upload.
    expect(countsStep.run).toContain("timeout -k 30 420 psql");
    expect(platform.match(/timeout -k 30 300 supabase db dump/g)).toHaveLength(2);

    // The connection string never enters GITHUB_ENV, so the third-party CLI
    // installer and the heartbeat cannot see it; only three steps read it.
    const steps = job.steps as (Step & { uses?: string })[];
    const build = steps.findIndex((each) => each.name === "Build the database connection string");
    const installer = steps.findIndex((each) =>
      (each.uses ?? "").startsWith("supabase/setup-cli@")
    );
    expect(installer).toBeLessThan(build);
    expect(steps[build].run).not.toContain("GITHUB_ENV");
    expect(
      steps
        .filter((each) => (each.run ?? "").includes('"$RUNNER_TEMP/db-url"'))
        .map((each) => each.name)
    ).toEqual([
      "Build the database connection string",
      "Dump roles, schema and data",
      "Dump the Supabase platform schemas",
      "Record row counts and the schema fingerprint",
      "Forget the connection string",
    ]);
    expect(JSON.stringify(steps)).not.toMatch(/DB_URL=[^$]*GITHUB_ENV|\$\{\{ env\.DB_URL/);
    const counts = countsStep.run!;
    expect(counts).toContain('"$tools/backup-manifest.sql"');
    expect(counts).toContain('"$tools/dump-row-counts.awk"');
    expect(counts).toContain('"$tools/merge-row-counts.awk"');
    // Counts and hashes only reach the log; the per-table file is archived.
    expect(counts).not.toMatch(/cat (ROW-COUNTS|row-counts)/);
    expect(counts).not.toContain("/dev/stderr");
    expect(counts).toContain("cat FINGERPRINT.tsv");
    const manifest = readFileSync(".github/backup/backup-manifest.sql", "utf8");
    expect(manifest).toContain("repeatable read read only");
    expect(manifest).toContain("set local row_security = off");
    expect(manifest).toContain("count(*)");
    expect(manifest).toContain("\\ir ../../database/foundation/fingerprint.sql");
    expect(manifest).toContain('set local search_path to "$user", public;');

    expect(step("Write the manifest")).toContain("ROW-COUNTS.tsv FINGERPRINT.tsv");
    const encrypt = step("Encrypt the backup");
    expect(encrypt).toContain("--files-from archive-files.txt");
    expect(encrypt).toContain("xargs shred -u < archive-files.txt");

    // Two runs 12 hours apart, off the top of the hour.
    expect(workflow.on.schedule.map((entry) => entry.cron)).toEqual(["47 20 * * *", "47 8 * * *"]);
  });

  it("alerts when the newest stored backup is too old or schedules are about to pause", () => {
    const freshness = parse(readFileSync(".github/workflows/backup-freshness.yml", "utf8")) as {
      on: Record<string, unknown>;
      permissions: Record<string, string>;
      jobs: Record<
        string,
        Job & { env: Record<string, string>; permissions?: Record<string, string> }
      >;
    };
    expect(freshness.permissions).toEqual({});
    expect("schedule" in freshness.on).toBe(true);
    const stored = freshness.jobs["stored-backup"];
    expect(stored.permissions).toBeUndefined();
    expect(stored.env.MAX_AGE_HOURS).toBe("27");
    const check = stored.steps[0];
    expect(check.run).toContain("list-objects-v2");
    expect(check.run).toContain('[ "$age_seconds" -ge "$((MAX_AGE_HOURS * 3600))" ]');
    expect(check.run).toContain('[ "$age_seconds" -lt "$((-MAX_FUTURE_SECONDS))" ]');
    // The newest object is chosen over every page's lines, not per page.
    expect(check.run).toContain("--output text");
    expect(check.run).toContain("| LC_ALL=C sort | tail -n 1");
    // Lists only: no download, copy or delete.
    expect(check.run).not.toMatch(/get-object|s3 cp|s3 rm|delete-object/);
    const pause = freshness.jobs["schedule-pause"];
    expect(pause.permissions).toEqual({ contents: "read" });
    expect(pause.env.WARN_AFTER_DAYS).toBe("45");
    for (const job of Object.values(freshness.jobs))
      for (const each of job.steps) {
        expect(each.if).toBeUndefined();
        expect(each["continue-on-error"]).toBeUndefined();
        expect(each.run ?? "").toContain("exit 1");
      }
  });
});

describe("backup and alert scripts, run for real on sample inputs", () => {
  // GitHub runs these blocks with bash; on Windows use Git's bash (and its
  // awk and GNU date) rather than whatever "bash" resolves to.
  const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
  const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
  const posix = (file: string) => path.resolve(file).replace(/\\/g, "/");
  const backupWorkflow = parse(readFileSync(".github/workflows/database-backup.yml", "utf8")) as {
    jobs: Record<string, Job>;
  };
  const freshness = parse(readFileSync(".github/workflows/backup-freshness.yml", "utf8")) as {
    jobs: Record<string, Job & { env: Record<string, string> }>;
  };
  const runOf = (job: Job, name?: string) =>
    (name ? job.steps.find((step) => step.name === name)! : job.steps[0]).run!;

  function withDir<T>(body: (dir: string) => T): T {
    const dir = mkdtempSync(path.join(tmpdir(), "vm-backup-"));
    try {
      return body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Runs `script` the way GitHub does (bash -eo pipefail) in `cwd`.
  function sh(cwd: string, script: string, env: Record<string, string> = {}) {
    const file = path.join(cwd, "step.sh");
    writeFileSync(file, script);
    const result = spawnSync(bash, ["-eo", "pipefail", "step.sh"], {
      cwd,
      env: { NODE_ENV: "test", PATH: process.env.PATH, ...env },
      encoding: "utf8",
      windowsHide: true,
    });
    return { status: result.status, log: result.stdout + result.stderr };
  }

  const awkFile = (name: string) => posix(`.github/backup/${name}`);

  it("counts one row per COPY line, escaped newlines included", () =>
    withDir((dir) => {
      writeFileSync(
        path.join(dir, "data.sql"),
        [
          "SET session_replication_role = replica;",
          'COPY "private"."posts" ("id", "body") FROM stdin;',
          "1\trow one\\nstill row one",
          "2\trow two",
          "\\.",
          "",
          'COPY "private"."profiles" ("id") FROM stdin;',
          "\\.",
          'COPY "auth"."users" ("id") FROM stdin;',
          "a",
          "\\.",
          "RESET ALL;",
          "",
        ].join("\n")
      );
      writeFileSync(
        path.join(dir, "platform-data.sql"),
        'COPY "supabase_migrations"."schema_migrations" ("version") FROM stdin;\n1\n2\n3\n\\.\n'
      );
      const result = sh(
        dir,
        `awk -f "${awkFile("dump-row-counts.awk")}" data.sql platform-data.sql > out.tsv`
      );
      expect(result.status, result.log).toBe(0);
      expect(readFileSync(path.join(dir, "out.tsv"), "utf8")).toBe(
        "private\tposts\t2\nprivate\tprofiles\t0\nauth\tusers\t1\nsupabase_migrations\tschema_migrations\t3\n"
      );
    }));

  const merge = (dir: string, dump: string, live: string) => {
    writeFileSync(path.join(dir, "dump.tsv"), dump);
    writeFileSync(path.join(dir, "live.tsv"), live);
    const result = sh(
      dir,
      `awk -v app_schemas=api,private,internal,public -v gaps_file=gaps.txt -f "${awkFile("merge-row-counts.awk")}" dump.tsv live.tsv > ROW-COUNTS.tsv`
    );
    return {
      ...result,
      rows: readFileSync(path.join(dir, "ROW-COUNTS.tsv"), "utf8"),
      gaps: readFileSync(path.join(dir, "gaps.txt"), "utf8").trim(),
    };
  };

  it("merges live and dump counts and counts only application-schema gaps", () =>
    withDir((dir) => {
      const result = merge(
        dir,
        [
          "private\tposts\t7",
          "private\tlocked\t0",
          "private\toutbox\t0",
          "private\temptied\t0",
          "private\tshort\t1000",
          "private\tgrowing\t1000",
          "private\tshrinking\t10",
          "api\tbig\t100000",
          "supabase_migrations\tschema_migrations\t2",
          "",
        ].join("\n"),
        [
          "auth\tschema_migrations\t7", // left out by the CLI: not an application gap
          "private\tlocked\tno_access", // unreadable: a gap
          "private\tmissing\t3", // not in the dump: a gap
          "private\tposts\t7",
          "private\toutbox\t4", // filled after the snapshot: within tolerance
          "private\temptied\t60", // none dumped, 60 live: above tolerance, a gap
          "private\tshort\t1100", // 100 more than dumped, above max(50, 1%): a gap
          "private\tgrowing\t1040", // 40 written during the dump: within tolerance
          "private\tshrinking\t8", // fewer live than dumped (deletes): never a gap
          "api\tbig\t100900", // 900 more, within 1% of 100,900
          "supabase_migrations\tschema_migrations\t3", // not an application schema
          "",
        ].join("\n")
      );
      expect(result.status, result.log).toBe(0);
      expect(result.rows).toBe(
        [
          "schema\ttable\tlive_rows\tdump_rows",
          "auth\tschema_migrations\t7\tnot_in_dump",
          "private\tlocked\tno_access\t0",
          "private\tmissing\t3\tnot_in_dump",
          "private\tposts\t7\t7",
          "private\toutbox\t4\t0",
          "private\temptied\t60\t0",
          "private\tshort\t1100\t1000",
          "private\tgrowing\t1040\t1000",
          "private\tshrinking\t8\t10",
          "api\tbig\t100900\t100000",
          "supabase_migrations\tschema_migrations\t3\t2",
          "",
        ].join("\n")
      );
      expect(result.gaps).toBe("4");
    }));

  it("finds no gaps in an empty live file (the step treats that as a problem)", () =>
    withDir((dir) => {
      const result = merge(dir, "private\tposts\t1\n", "");
      expect(result.status, result.log).toBe(0);
      expect([result.rows, result.gaps]).toEqual(["", "0"]);
    }));

  describe("the row-count step records every failure and never stops the backup", () => {
    const step = runOf(backupWorkflow.jobs.backup, "Record row counts and the schema fingerprint");
    const live = "private\tposts\t1\nprivate\tprofiles\t0\n";
    const dataSql =
      'COPY "private"."posts" ("id") FROM stdin;\n1\n\\.\nCOPY "private"."profiles" ("id") FROM stdin;\n\\.\n';

    function runStep(options: { live?: string | null; fingerprint?: boolean; workspace?: string }) {
      return withDir((dir) => {
        const backup = path.join(dir, "backup");
        mkdirSync(backup);
        writeFileSync(path.join(backup, "data.sql"), dataSql);
        writeFileSync(path.join(dir, "db-url"), "postgresql://unused");
        // A stand-in psql executable (the step runs it through `timeout`):
        // writes what backup-manifest.sql would.
        const bin = path.join(dir, "bin");
        mkdirSync(bin);
        const lines = ["#!/bin/bash"];
        if (options.live !== null) {
          writeFileSync(path.join(dir, "live-source.tsv"), options.live ?? live);
          lines.push(`cp "${posix(path.join(dir, "live-source.tsv"))}" row-counts-live.tsv`);
        }
        if (options.fingerprint !== false)
          lines.push("printf 'columns\\t4\\tabc\\n' > fingerprint.tsv");
        writeFileSync(path.join(bin, "psql"), `${lines.join("\n")}\n`, { mode: 0o755 });
        // PATH entries cannot hold a drive letter's colon, so use $PWD.
        const result = sh(dir, `export PATH="$PWD/bin:$PATH"\n${step}`, {
          RUNNER_TEMP: posix(dir),
          GITHUB_ENV: posix(path.join(dir, "env")),
          GITHUB_WORKSPACE: options.workspace ?? posix("."),
          BACKUP_SCHEMAS: "api,private,internal,public,auth,extensions",
          APP_SCHEMAS: "api,private,internal,public",
        });
        const read = (name: string) =>
          existsSync(path.join(backup, name))
            ? readFileSync(path.join(backup, name), "utf8")
            : null;
        return {
          ...result,
          problems: read("problems.txt"),
          rowCounts: read("ROW-COUNTS.tsv"),
          fingerprint: read("FINGERPRINT.tsv"),
          leftovers: readdirSync(backup).filter((name) => /^row-count/.test(name)),
        };
      });
    }

    it("writes ROW-COUNTS.tsv and FINGERPRINT.tsv when everything is present", () => {
      const result = runStep({});
      expect(result.status, result.log).toBe(0);
      expect(result.problems).toBeNull();
      expect(result.rowCounts).toBe(
        "schema\ttable\tlive_rows\tdump_rows\nprivate\tposts\t1\t1\nprivate\tprofiles\t0\t0\n"
      );
      expect(result.fingerprint).toBe("columns\t4\tabc\n");
      expect(result.leftovers).toEqual([]);
    });

    it("records an application table missing from the dump, naming no table in the log", () => {
      const result = runStep({ live: `${live}private\tsecret_table\t5\n` });
      expect(result.status, result.log).toBe(0);
      expect(result.problems).toContain("1 table(s) in api,private,internal,public missing");
      expect(result.log).not.toContain("secret_table");
      expect(result.rowCounts).toContain("private\tsecret_table\t5\tnot_in_dump");
    });

    it("records a table with more live rows than the tolerance but none dumped", () => {
      const result = runStep({ live: "private\tposts\t1\nprivate\tprofiles\t60\n" });
      expect(result.status, result.log).toBe(0);
      expect(result.problems).toContain("1 table(s) in api,private,internal,public missing");
    });

    it("records an empty or missing live-count file as a problem", () => {
      for (const missing of ["", null]) {
        const result = runStep({ live: missing });
        expect(result.status, result.log).toBe(0);
        expect(result.problems).toContain("no live row counts were returned");
        expect(result.rowCounts).toBeNull();
        expect(result.leftovers).toEqual([]);
      }
    });

    it("records a failed awk and keeps going", () => {
      const result = runStep({ workspace: posix(path.join(tmpdir(), "vm-backup-no-such-dir")) });
      expect(result.status, result.log).toBe(0);
      expect(result.problems).toContain("the dump could not be counted");
      expect(result.rowCounts).toBeNull();
      expect(result.leftovers).toEqual([]);
    });

    it("records a missing fingerprint and keeps going", () => {
      const result = runStep({ fingerprint: false });
      expect(result.status, result.log).toBe(0);
      expect(result.problems).toContain("no fingerprint was returned");
      expect(result.rowCounts).toBeNull();
      expect(result.fingerprint).toBeNull();
    });
  });

  it("stores the encrypted file even when shredding the plaintext fails", () =>
    withDir((dir) => {
      const backup = path.join(dir, "backup");
      mkdirSync(backup);
      for (const name of ["MANIFEST.txt", "roles.sql", "schema.sql", "data.sql"])
        writeFileSync(path.join(backup, name), `${name}\n`);
      writeFileSync(
        path.join(backup, "archive-files.txt"),
        "MANIFEST.txt\nroles.sql\nschema.sql\ndata.sql\n"
      );
      const bin = path.join(dir, "bin");
      mkdirSync(bin);
      writeFileSync(path.join(bin, "shred"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
      const gnupg = path.join(dir, "gnupg");
      mkdirSync(gnupg, { mode: 0o700 });
      const result = sh(
        dir,
        `export PATH="$PWD/bin:$PATH" GNUPGHOME="$PWD/gnupg"\n${runOf(backupWorkflow.jobs.backup, "Encrypt the backup")}`,
        {
          RUNNER_TEMP: posix(dir),
          GITHUB_ENV: posix(path.join(dir, "env")),
          GITHUB_WORKSPACE: posix("."),
        }
      );
      expect(result.status, result.log).toBe(0);
      expect(readFileSync(path.join(dir, "env"), "utf8")).toMatch(
        /^BACKUP_FILE=.+\.tar\.gz\.gpg$/m
      );
      expect(readFileSync(path.join(backup, "problems.txt"), "utf8")).toContain(
        "plaintext files could not be shredded"
      );
      // The plaintext is deleted instead; only the encrypted copy remains.
      expect(
        readdirSync(backup)
          .filter((name) => /\.(sql|txt)$/.test(name))
          .sort()
      ).toEqual(["archive-files.txt", "problems.txt"]);
    }));

  describe("backup storage credentials", () => {
    const upload = (env: Record<string, string>) =>
      withDir((dir) => {
        writeFileSync(path.join(dir, "backup.gpg"), "synthetic");
        const stub = `aws() { if [ "$1" = s3api ]; then stat -c %s "$BACKUP_FILE"; else echo "used=$AWS_ACCESS_KEY_ID"; fi; }`;
        return sh(
          dir,
          `${stub}\n${runOf(backupWorkflow.jobs.backup, "Upload to the private R2 bucket")}`,
          {
            BACKUP_FILE: "backup.gpg",
            BACKUP_KEY: "database/x/backup.gpg",
            BACKUP_BUCKET: "verifymzansi-backups",
            R2_ACCOUNT_ID: "synthetic",
            ...env,
          }
        );
      });
    const freshnessCheck = (env: Record<string, string>) =>
      withDir((dir) => {
        const now = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
        const stub = `aws() { echo "used=$AWS_ACCESS_KEY_ID" >&2; printf '%s\\t1\\n' '${now}'; }`;
        return sh(dir, `${stub}\n${runOf(freshness.jobs["stored-backup"])}`, {
          ...freshness.jobs["stored-backup"].env,
          MAX_FUTURE_SECONDS: "300",
          R2_ACCOUNT_ID: "synthetic",
          ...env,
        });
      });
    const scoped = { BACKUP_R2_ACCESS_KEY_ID: "scoped-id", BACKUP_R2_SECRET_ACCESS_KEY: "s" };
    const legacy = { LEGACY_R2_ACCESS_KEY_ID: "app-id", LEGACY_R2_SECRET_ACCESS_KEY: "s" };

    for (const [label, run] of [
      ["upload", upload],
      ["freshness check", freshnessCheck],
    ] as const) {
      it(`${label}: prefers the bucket-scoped token over the app's storage key`, () => {
        const result = run({ ...scoped, ...legacy });
        expect(result.status, result.log).toBe(0);
        expect(result.log).toContain("used=scoped-id");
        expect(result.log).not.toContain("Backups still use the app's storage key");
      });

      it(`${label}: falls back to the app's storage key with a warning`, () => {
        const result = run(legacy);
        expect(result.status, result.log).toBe(0);
        expect(result.log).toContain("used=app-id");
        expect(result.log).toContain("::warning::Backups still use the app's storage key");
      });

      it(`${label}: refuses half a token and no credentials at all`, () => {
        const half = run({ BACKUP_R2_ACCESS_KEY_ID: "scoped-id", ...legacy });
        expect(half.status).toBe(1);
        expect(half.log).toContain(
          "Set both BACKUP_R2_ACCESS_KEY_ID and BACKUP_R2_SECRET_ACCESS_KEY"
        );
        expect(half.log).not.toContain("used=");
        const none = run({});
        expect(none.status).toBe(1);
        expect(none.log).not.toContain("used=");
      });
    }
  });

  describe("the freshness check's age arithmetic", () => {
    const iso = (offsetMinutes: number) =>
      new Date(Date.now() + offsetMinutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
    const stored = freshness.jobs["stored-backup"];
    const check = (newest: string) =>
      withDir((dir) =>
        sh(dir, `aws() { printf '%s\\n' '${newest}'; }\n${runOf(stored)}`, {
          ...stored.env,
          MAX_FUTURE_SECONDS: stored.steps[0].env!.MAX_FUTURE_SECONDS,
          R2_ACCOUNT_ID: "synthetic",
          BACKUP_R2_ACCESS_KEY_ID: "synthetic-id",
          BACKUP_R2_SECRET_ACCESS_KEY: "synthetic-secret",
        })
      );

    it("passes a backup just under 27 hours old", () => {
      const result = check(`${iso(-(27 * 60 - 10))}\t1234`);
      expect(result.status, result.log).toBe(0);
      expect(result.log).toContain("(26 hours ago, 1234 bytes)");
    });

    it("fails at 27 hours", () => {
      const result = check(`${iso(-(27 * 60 + 1))}\t1234`);
      expect(result.status).toBe(1);
      expect(result.log).toContain("Database backups stopped");
    });

    it("allows 5 minutes of clock skew, then fails a timestamp in the future", () => {
      expect(check(`${iso(2)}\t1234`).status).toBe(0);
      const result = check(`${iso(10)}\t1234`);
      expect(result.status).toBe(1);
      expect(result.log).toContain("Backup date in the future");
    });

    it("picks the newest object across all pages, not the last line of a page", () => {
      const newest = iso(-60);
      // Pages as the CLI prints them: newest on the first page, an empty page.
      const pages = [`${newest}\t300`, `${iso(-30 * 60)}\t100`, "None", `${iso(-20 * 60)}\t200`];
      const result = check(pages.join("\n"));
      expect(result.status, result.log).toBe(0);
      expect(result.log).toContain(`Newest backup stored ${newest} (1 hours ago, 300 bytes)`);
    });

    it("fails an empty bucket and an empty object", () => {
      expect(check("None").status).toBe(1);
      expect(check(`${iso(-60)}\t0`).status).toBe(1);
    });

    it("warns from 45 days without a commit", () => {
      const pause = freshness.jobs["schedule-pause"];
      const run = (offsetMinutes: number) =>
        withDir((dir) =>
          sh(dir, `gh() { printf '%s\\n' '${iso(offsetMinutes)}'; }\n${runOf(pause)}`, {
            ...pause.env,
            GH_REPO: "owner/repo",
          })
        );
      expect(run(-(44 * 24 * 60)).status).toBe(0);
      const late = run(-(45 * 24 * 60 + 60));
      expect(late.status).toBe(1);
      expect(late.log).toContain("Scheduled workflows pause soon");
    });
  });

  // `gh` here answers from JSON fixtures and runs the workflow's own --jq
  // filter with jq (GitHub's runners have jq; gh itself embeds the same
  // language). Issue writes are recorded in calls.txt instead.
  const hasJq = spawnSync(bash, ["-c", "command -v jq"], { windowsHide: true }).status === 0;
  // Only a local machine without jq may skip; in CI a missing jq fails.
  const skipJq = !hasJq && !process.env.CI;
  it.runIf(process.env.CI)("has jq in CI for the alert script tests", () => {
    expect(hasJq).toBe(true);
  });
  const ghStub = `gh() {
  local filter="" key="" i
  local args=("$@")
  for ((i = 0; i < \${#args[@]}; i++)); do
    if [ "\${args[i]}" = "--jq" ]; then filter="\${args[i+1]}"; fi
  done
  case "$1 $2" in
    "issue create") echo create >> calls.txt; echo "https://github.com/o/r/issues/300"; return ;;
    "issue comment") echo "comment $3" >> calls.txt; return ;;
    "issue list") key=issues ;;
    "api -X") echo "assign $4 $6" >> calls.txt; key=assign ;;
    "api "*) key=$(printf '%s' "$2" | sed -e 's/[?].*//' -e 's#^repos/o/r/##' -e 's#[^A-Za-z0-9]#_#g') ;;
    *) echo "unexpected gh $*" >&2; return 1 ;;
  esac
  if [ ! -f "fixtures/$key.json" ]; then echo "no fixture $key" >&2; return 1; fi
  jq -r "\${filter:-.}" "fixtures/$key.json"
}
`;
  function withFixtures(
    script: string,
    fixtures: Record<string, unknown>,
    env: Record<string, string>
  ) {
    return withDir((dir) => {
      mkdirSync(path.join(dir, "fixtures"));
      for (const [key, value] of Object.entries(fixtures))
        if (value !== undefined)
          writeFileSync(path.join(dir, "fixtures", `${key}.json`), JSON.stringify(value));
      const result = sh(dir, ghStub + script, { GH_REPO: "o/r", ...env });
      const calls = existsSync(path.join(dir, "calls.txt"))
        ? readFileSync(path.join(dir, "calls.txt"), "utf8")
        : "";
      return { ...result, calls };
    });
  }
  const sha = (letter: string) => letter.repeat(40);
  const ago = (minutes: number) =>
    new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  type StepResult = [name: string, conclusion: string | null];
  const jobs = (...list: [name: string, conclusion: string, steps: StepResult[]][]) => ({
    jobs: list.map(([name, conclusion, steps]) => ({
      name,
      conclusion,
      steps: steps.map(([stepName, stepConclusion]) => ({
        name: stepName,
        conclusion: stepConclusion,
      })),
    })),
  });

  describe.skipIf(skipJq)("the failure alert script", () => {
    const alert = parse(readFileSync(".github/workflows/failure-alert.yml", "utf8")) as {
      jobs: Record<string, Job>;
    };
    const recheck = "Recheck main immediately before *** changes";
    type RunOf = [name: string, event: string, status: string, conclusion: string | null];
    const newerRuns = (...list: RunOf[]) => ({
      workflow_runs: list.map(([name, event, status, conclusion], index) => ({
        id: 600 + index,
        name,
        event,
        status,
        conclusion,
        head_branch: "main",
        head_sha: sha("b"),
      })),
    });
    const deployJobs = (steps: StepResult[], conclusion = "failure") =>
      jobs(["Staging configured", "success", []], ["deploy", conclusion, steps]);
    const base = {
      issues: [{ number: 157, title: "Automated alert: a main or scheduled workflow run failed" }],
      issues_157_comments: [],
      commits_main: { sha: sha("b") },
      assign: { assignees: [{ login: "owner" }] },
      actions_runs_500_attempts_1_jobs: deployJobs([
        ["Reject stale deployment sources before using provider credentials", "success"],
        [recheck, "failure"],
        ["Deploy to Cloudflare", "skipped"],
      ]),
      // Runs for the newer main commit b: its CI run is still going.
      actions_runs: newerRuns(["CI", "push", "in_progress", null]),
    };
    const run = (fixtures: Record<string, unknown> = {}, env: Record<string, string> = {}) =>
      withFixtures(
        runOf(alert.jobs.alert),
        { ...base, ...fixtures },
        {
          OWNER: "owner",
          WORKFLOW: "Deploy",
          EVENT: "workflow_run",
          CONCLUSION: "failure",
          RUN_ID: "500",
          RUN_URL: "https://example.invalid/run",
          RUN_ATTEMPT: "1",
          HEAD_SHA: sha("a"),
          ...env,
        }
      );

    it("stays quiet when a deploy stopped only because main moved on", () => {
      for (const steps of [
        [[recheck, "failure"]],
        [["Reject stale deployment sources before using provider credentials", "failure"]],
      ] as StepResult[][]) {
        const result = run({ actions_runs_500_attempts_1_jobs: deployJobs(steps) });
        expect(result.status, result.log).toBe(0);
        expect(result.log).toContain("No alert");
        expect(result.calls).toBe("");
      }
    });

    it("stays quiet only while a newer deploy for the newest main is on its way", () => {
      for (const runs of [
        newerRuns(["Deploy", "workflow_run", "queued", null]),
        newerRuns(["Deploy", "workflow_run", "completed", "failure"]), // alerts by itself
        newerRuns(["CI", "push", "completed", "success"]),
        newerRuns(["CI", "pull_request", "completed", "failure"], ["CI", "push", "queued", null]),
      ]) {
        const result = run({ actions_runs: runs });
        expect(result.status, result.log).toBe(0);
        expect(result.log).toMatch(/which (Deploy|CI) run 60\d is releasing\. No alert/);
        expect(result.calls).toBe("");
      }
    });

    it("matches the deploy steps that stop a release because main moved on", () => {
      const deploy = parse(readFileSync(".github/workflows/deploy.yml", "utf8")) as {
        jobs: Record<string, Job>;
      };
      const script = runOf(alert.jobs.alert);
      const prefixes = /grep -Ev '\^\(([^)]+)\)'/.exec(script)![1].split("|");
      expect(prefixes).toEqual([
        "Reject stale deployment sources",
        "Recheck main immediately before",
      ]);
      const named = (job: string, prefix: string) =>
        deploy.jobs[job].steps.filter((step) => step.name?.startsWith(prefix));
      // Each marker step compares main with the commit being deployed, and
      // only steps that do so carry a marker name.
      for (const [job, prefix] of [
        ["deploy-staging", prefixes[0]],
        ["deploy", prefixes[0]],
        ["deploy", prefixes[1]],
      ]) {
        const steps = named(job, prefix);
        expect(steps, `${job}: ${prefix}`).toHaveLength(1);
        expect(steps[0].run).toContain("git fetch --no-tags origin main");
        expect(steps[0].run).toMatch(
          /"\$\(git rev-parse origin\/main\)" !?= "\$DEPLOY_TARGET_SHA"/
        );
      }
      expect(named("deploy-staging", prefixes[1])).toHaveLength(0);
    });

    it("alerts when main moved on but nothing is releasing the newer main", () => {
      const other = (field: "head_sha" | "head_branch", value: string) => {
        const runs = newerRuns(["Deploy", "workflow_run", "in_progress", null]);
        Object.assign(runs.workflow_runs[0], { [field]: value });
        return runs;
      };
      for (const runs of [
        { workflow_runs: [] },
        newerRuns(["CI", "push", "completed", "failure"]),
        newerRuns(["CI", "push", "completed", "cancelled"]),
        newerRuns(["CI", "pull_request", "in_progress", null]),
        newerRuns(["Deploy", "workflow_run", "completed", "skipped"]),
        newerRuns(["Deploy", "workflow_run", "completed", "cancelled"]),
        newerRuns(["Security Scan", "push", "in_progress", null]),
        other("head_sha", sha("c")), // the API ignored the commit filter
        other("head_branch", "feature"),
        undefined, // the runs cannot be read
      ]) {
        const result = run({ actions_runs: runs });
        expect(result.status, result.log).toBe(0);
        expect(result.log).not.toContain("No alert");
        expect(result.calls).toBe(
          "comment 157\nassign repos/o/r/issues/157/assignees assignees[]=owner\n"
        );
      }
      // main cannot be read, or reads as something other than a commit.
      for (const commits_main of [undefined, { sha: "main" }]) {
        const result = run({ commits_main });
        expect(result.calls, result.log).toContain("comment 157");
      }
    });

    it("still alerts, and assigns the owner, for any other deploy failure", () => {
      for (const fixtures of [
        { commits_main: { sha: sha("a") } }, // main did not move
        {
          actions_runs_500_attempts_1_jobs: deployJobs([
            [recheck, "failure"],
            ["Build for Cloudflare", "failure"],
          ]),
        },
        // A failed job with no failed step, beside a "main moved" step.
        {
          actions_runs_500_attempts_1_jobs: jobs(
            ["deploy", "failure", [[recheck, "failure"]]],
            ["Deploy staging and smoke-test it", "failure", []]
          ),
        },
        { actions_runs_500_attempts_1_jobs: undefined }, // unreadable run
      ]) {
        const result = run(fixtures);
        expect(result.status, result.log).toBe(0);
        expect(result.calls).toBe(
          "comment 157\nassign repos/o/r/issues/157/assignees assignees[]=owner\n"
        );
      }
    });

    it("alerts on a deploy cancelled after production changes began, not before", () => {
      const cancelled = { CONCLUSION: "cancelled" };
      const early = run(
        { actions_runs_500_attempts_1_jobs: deployJobs([[recheck, null]], "cancelled") },
        cancelled
      );
      expect(early.status, early.log).toBe(0);
      expect(early.calls).toBe("");
      // A run cancelled while it waited has no jobs at all.
      expect(run({ actions_runs_500_attempts_1_jobs: { jobs: [] } }, cancelled).calls).toBe("");
      const late = run(
        {
          actions_runs_500_attempts_1_jobs: deployJobs(
            [
              [recheck, "success"],
              ["Deploy to Cloudflare", "cancelled"],
            ],
            "cancelled"
          ),
        },
        cancelled
      );
      expect(late.calls).toContain("comment 157");
    });

    it("opens and assigns a new issue when none is open", () => {
      const result = run({ issues: [], commits_main: { sha: sha("a") } });
      expect(result.status, result.log).toBe(0);
      expect(result.calls).toBe(
        "create\nassign repos/o/r/issues/300/assignees assignees[]=owner\n"
      );
    });

    it("comments at most every 6 hours per workflow", () => {
      const env = { WORKFLOW: "Synthetic Monitoring", EVENT: "schedule" };
      const recent = run(
        { issues_157_comments: [{ body: "Workflow: Synthetic Monitoring\nWhat it means: x" }] },
        env
      );
      expect(recent.calls).not.toContain("comment");
      expect(recent.log).toContain("already has a recent alert");
      const other = run({ issues_157_comments: [{ body: "Workflow: CI\nWhat it means: x" }] }, env);
      expect(other.calls).toContain("comment 157");
    });

    it("fails visibly, after posting, when the owner cannot be assigned", () => {
      const result = run({ assign: { assignees: [] }, commits_main: { sha: sha("a") } });
      expect(result.status).toBe(1);
      expect(result.calls).toContain("comment 157");
      expect(result.log).toContain("Alert not assigned");
    });
  });

  describe.skipIf(skipJq)("the main-deployed check", () => {
    const job = (
      parse(readFileSync(".github/workflows/main-deployed.yml", "utf8")) as {
        jobs: Record<string, Job & { env: Record<string, string> }>;
      }
    ).jobs["main-deployed"];
    const deployed = jobs(["deploy", "success", [["Deploy to Cloudflare", "success"]]]);
    const notDeployed = jobs(["deploy", "failure", [["Deploy to Cloudflare", "skipped"]]]);
    // Deploy runs newest first: 4 (d) cancelled after its deploy step, 3 (c)
    // skipped (CI failed), 2 (b) deployed, 1 (a) deployed.
    const fixtures = (main: string, mainAgo: number, ci: [number, string][]) => ({
      commits_main: { sha: main, commit: { committer: { date: ago(mainAgo) } } },
      actions_workflows_deploy_yml_runs: {
        workflow_runs: [
          { id: 4, head_sha: sha("d"), conclusion: "cancelled" },
          { id: 3, head_sha: sha("c"), conclusion: "skipped" },
          { id: 2, head_sha: sha("b"), conclusion: "success" },
          { id: 1, head_sha: sha("a"), conclusion: "success" },
        ],
      },
      actions_runs_4_jobs: deployed,
      actions_runs_3_jobs: notDeployed,
      actions_runs_2_jobs: deployed,
      actions_runs_1_jobs: deployed,
      actions_workflows_ci_yml_runs: {
        workflow_runs: ci.map(([minutes, head]) => ({
          created_at: ago(minutes),
          head_sha: sha(head),
        })),
      },
    });
    const check = (value: Record<string, unknown>) =>
      withFixtures(runOf(job), value, { ...job.env });

    it("passes when the newest main commit is live, never counting a cancelled deploy", () => {
      const live = check(fixtures(sha("b"), 600, [[600, "b"]]));
      expect(live.status, live.log).toBe(0);
      expect(live.log).toContain("runs the newest main commit");
      // d's run was cancelled, so b is live and d has waited 4 hours.
      const cancelled = check(
        fixtures(sha("d"), 240, [
          [240, "d"],
          [600, "b"],
        ])
      );
      expect(cancelled.status).toBe(1);
      expect(cancelled.log).toContain("live " + sha("b"));
    });

    it("gives a newer commit 3 hours to go live, counted from the first undeployed push", () => {
      const ci = (first: number): [number, string][] => [
        [10, "e"],
        [first, "c"],
        [600, "b"],
      ];
      const waiting = check(fixtures(sha("e"), 10, ci(170)));
      expect(waiting.status, waiting.log).toBe(0);
      expect(waiting.log).toContain("the live site runs " + sha("b"));
      const late = check(fixtures(sha("e"), 10, ci(190)));
      expect(late.status).toBe(1);
      expect(late.log).toContain("Main not deployed");
    });

    it("waits for a push whose CI run is not listed yet", () => {
      const fresh = check(fixtures(sha("e"), 1, [[600, "b"]]));
      expect(fresh.status, fresh.log).toBe(0);
      expect(fresh.log).toContain("Newer commits arrived 1 minutes ago");
      expect(check(fixtures(sha("e"), 200, [[600, "b"]])).status).toBe(1);
    });

    it("fails when the live commit is not among the recent pushes", () => {
      const result = check(fixtures(sha("e"), 10, [[10, "e"]]));
      expect(result.status).toBe(1);
      expect(result.log).toContain("not among the last 100 pushes");
    });

    it("fails clearly when main cannot be read", () => {
      const result = check({ ...fixtures(sha("b"), 600, [[600, "b"]]), commits_main: undefined });
      expect(result.status).toBe(1);
      expect(result.log).toContain("Could not read the newest main commit");
    });
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

  // Evaluates the few expressions the concurrency groups use, for one event.
  const evaluate = (template: string, event: "push" | "pull_request") => {
    const values: Record<string, string | undefined> = {
      "github.sha": "a".repeat(40),
      "github.event_name": event,
      "github.event.pull_request.number": event === "pull_request" ? "7" : undefined,
      "github.ref": event === "pull_request" ? "refs/pull/7/merge" : "refs/heads/main",
    };
    const term = (text: string): string | undefined => {
      const call = /^format\('([^']*)',\s*(.+)\)$/.exec(text.trim());
      if (call) {
        const args = call[2].split(",").map((arg) => term(arg) ?? "");
        return call[1].replace(/\{(\d+)\}/g, (_, i) => args[Number(i)]);
      }
      if (!(text.trim() in values)) throw new Error(`Unknown expression ${text}`);
      return values[text.trim()];
    };
    return template.replace(
      /\$\{\{\s*(.+?)\s*\}\}/g,
      (_, expression: string) =>
        expression
          .split("||")
          .map(term)
          .reduce((left, right) => left || right, undefined as string | undefined) ?? ""
    );
  };

  it("makes foundation-native and e2e-foundation part of the main release gate, never cancelling a main run", () => {
    const ci = load("ci.yml");
    for (const [file, caller] of [
      ["foundation-native.yml", "foundation-native-gate"],
      ["e2e-foundation.yml", "e2e-foundation-gate"],
    ] as const) {
      const workflow = load(file);
      // On main they run only inside CI (no separate push run to double up).
      expect(workflow.on.push, file).toBeUndefined();
      expect(workflow.on).toHaveProperty("workflow_call");
      // ready_for_review: a draft that becomes ready runs the full suite.
      expect(workflow.on.pull_request, file).toEqual({
        branches: ["main"],
        types: ["opened", "synchronize", "reopened", "ready_for_review"],
      });
      expect(workflow.concurrency?.["cancel-in-progress"], file).toBe(
        "${{ github.event_name == 'pull_request' }}"
      );
      // CI calls each one for every event except pull requests (manual runs
      // included, so a branch can prove the gate), in a per-commit group that
      // never cancels.
      const job = ci.jobs[caller] as unknown as {
        uses: string;
        if: string;
        concurrency: { group: string; "cancel-in-progress": boolean };
        permissions: Record<string, string>;
      };
      expect(job.uses, caller).toBe(`./.github/workflows/${file}`);
      expect(job.if, caller).toBe("github.event_name != 'pull_request'");
      expect(job.concurrency["cancel-in-progress"], caller).toBe(false);
      expect(job.permissions, caller).toEqual({ contents: "read" });
      // Evaluated, the three groups of a main run differ (a called group equal
      // to its caller's deadlocks and is cancelled), and a pull request's group
      // differs from a main run's.
      const groups = [
        ci.concurrency?.group,
        job.concurrency.group,
        workflow.concurrency?.group,
      ].map((group) => evaluate(String(group), "push"));
      expect(new Set(groups).size, caller).toBe(3);
      for (const group of groups) expect(group, caller).toContain("a".repeat(40));
      expect(evaluate(String(workflow.concurrency?.group), "pull_request")).not.toBe(groups[2]);
      // Nothing inside the called workflow can turn a failure into a pass or
      // skip the suite on main: no job condition except the aggregate's and
      // the browser projects' draft condition (false for every event but a
      // pull request), no continue-on-error anywhere.
      for (const [id, called] of Object.entries(workflow.jobs)) {
        expect(JSON.stringify(called), `${file} ${id}`).not.toContain("continue-on-error");
        if (id === "e2e-foundation") expect(called.if).toBe("${{ !cancelled() }}");
        else if (file === "e2e-foundation.yml" && id === "browser")
          expect(called.if).toBe(`\${{ !(${DRAFT_CONDITION}) }}`);
        else expect(called.if, `${file} ${id}`).toBeUndefined();
      }
    }
    // The native suite runs in full for every event except a pull request. A
    // draft skips it only in a run that reports under the draft name.
    const nativeJob = load("foundation-native.yml").jobs["foundation-native"];
    expect(nativeJob.name).toBe(draftRenamed("foundation-native"));
    const native = nativeJob.steps;
    const scope = native.find(
      (step) => step.name === "Decide whether the native suite inputs changed"
    );
    expect(scope?.env?.EVENT_NAME).toBe("${{ github.event_name }}");
    expect(scope?.env?.DRAFT_NOT_RUN).toBe(`\${{ ${DRAFT_CONDITION} }}`);
    expect(scope?.run?.trimStart()).toMatch(
      /^if \[ "\$DRAFT_NOT_RUN" = "true" \]; then\n\s+echo "run=false" >> "\$GITHUB_OUTPUT"\n[^\n]*\n\s+exit 0\n\s*fi\n\s*if \[ "\$EVENT_NAME" != "pull_request" \]; then\n\s+echo "run=true" >> "\$GITHUB_OUTPUT"\n[^\n]*\n\s+exit 0\n\s*fi/
    );
    // The aggregate check fails unless every browser project passed; it ends
    // green without them only in a draft run, which reports another name.
    const aggregate = load("e2e-foundation.yml").jobs["e2e-foundation"];
    expect(aggregate.name).toBe(draftRenamed("e2e-foundation"));
    expect(aggregate.needs).toBe("browser");
    expect(aggregate.steps[0].env?.DRAFT_NOT_RUN).toBe(`\${{ ${DRAFT_CONDITION} }}`);
    expect(aggregate.steps[0].env?.RESULT).toBe("${{ needs.browser.result }}");
    expect(aggregate.steps[0].run).toContain('if [ "$RESULT" != "success" ]; then');
    expect(aggregate.steps[0].run).toMatch(/exit 1\n\s*fi/);
    expect(ci.on.push).toEqual({ branches: ["main"] });
    // Deploy still waits for the whole main CI run, which now holds both suites.
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
    // Branch runs cannot alert, so they must not start a skipped run.
    expect((alert.on.workflow_run as { branches: string[] }).branches).toEqual(["main"]);
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
    expect(job.permissions).toEqual({ issues: "write", actions: "read" });
    // No code from the failed run is checked out or executed, and no event
    // value is pasted into the script (all arrive through env).
    for (const step of job.steps) {
      expect(step.uses).toBeUndefined();
      expect(step.run ?? "").not.toContain("${{");
    }
  });
});

describe("workflow hygiene", () => {
  const files = readdirSync(".github/workflows").filter((file) => file.endsWith(".yml"));
  const text = (file: string) => readFileSync(`.github/workflows/${file}`, "utf8");
  type AnyStep = { uses?: string; run?: string; with?: Record<string, unknown> };
  const steps = (file: string) =>
    Object.values(
      (parse(text(file)) as { jobs: Record<string, { steps?: AnyStep[] }> }).jobs
    ).flatMap((job) => job.steps ?? []);

  it("lints the workflows on every pull request with pinned, network-less tools", () => {
    const ci = parse(text("ci.yml")) as {
      jobs: Record<string, { name?: string; "continue-on-error"?: boolean; steps: AnyStep[] }>;
    };
    const lint = ci.jobs["workflow-lint"];
    expect(lint.name).toBe("Workflow lint (actionlint)");
    expect(lint["continue-on-error"]).toBeUndefined();
    const lintRun = lint.steps.map((step) => step.run ?? "").join("\n");
    expect(lintRun).toMatch(/image=rhysd\/actionlint:[\d.]+@sha256:[0-9a-f]{64} /);
    expect(lintRun).toContain(
      'docker run --rm --network none -v "$PWD:/repo:ro" -w /repo "$image"'
    );
    const audit = ci.jobs["workflow-audit-advisory"];
    expect(audit.name).toContain("advisory");
    expect(audit["continue-on-error"]).toBe(true);
    const auditRun = audit.steps.map((step) => step.run ?? "").join("\n");
    expect(auditRun).toMatch(/image=ghcr\.io\/zizmorcore\/zizmor:[\d.]+@sha256:[0-9a-f]{64} /);
    expect(auditRun).toContain(
      'docker run --rm --network none -v "$PWD:/repo:ro" -w /repo "$image" --offline'
    );
    const codeql = parse(text("codeql.yml")) as {
      jobs: { analyze: { strategy: { matrix: { language: string[] } } } };
    };
    expect(codeql.jobs.analyze.strategy.matrix.language).toEqual([
      "javascript-typescript",
      "actions",
    ]);
  });

  it("pins every action and image by digest, with a readable version beside it", () => {
    for (const file of files) {
      for (const line of text(file).split("\n")) {
        const action = /^\s*(?:- )?uses: ([^\s#]+)(.*)$/.exec(line);
        if (action && !action[1].startsWith("./")) {
          expect(action[1], `${file}: ${line.trim()}`).toMatch(/@[0-9a-f]{40}$/);
          expect(action[2], `${file}: ${line.trim()}`).toMatch(/# v\d/);
        }
      }
      expect(text(file), file).not.toMatch(/:latest\b/);
    }
  });

  it("keeps the checkout token out of the workspace unless the job pushes", () => {
    // update-visual-baselines pushes a branch.
    const allowed = new Set(["update-visual-baselines.yml"]);
    for (const file of files.filter((name) => !allowed.has(name))) {
      for (const step of steps(file).filter((item) => item.uses?.startsWith("actions/checkout@")))
        expect(step.with?.["persist-credentials"], file).toBe(false);
    }
  });

  it("lets Dependabot open one grouped monthly pull request for actions, none for npm", () => {
    const config = parse(readFileSync(".github/dependabot.yml", "utf8")) as {
      updates: {
        "package-ecosystem": string;
        schedule: { interval: string };
        "open-pull-requests-limit": number;
        groups?: Record<string, { patterns?: string[] }>;
      }[];
    };
    const actions = config.updates.find((item) => item["package-ecosystem"] === "github-actions");
    expect(actions?.schedule.interval).toBe("monthly");
    expect(actions?.["open-pull-requests-limit"]).toBe(1);
    expect(Object.values(actions?.groups ?? {}).map((group) => group.patterns)).toEqual([["*"]]);
    const npm = config.updates.find((item) => item["package-ecosystem"] === "npm");
    expect(npm?.["open-pull-requests-limit"]).toBe(0);
  });
});
