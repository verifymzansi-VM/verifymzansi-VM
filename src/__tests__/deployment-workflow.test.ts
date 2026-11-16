import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parse as parseToml } from "smol-toml";
import {
  collectStagingSecrets,
  STAGING_WORKER_SECRETS,
} from "../../scripts/prepare-staging-worker-secrets.mjs";
import { deployedVersionProblem } from "../../scripts/check-staging-deployed-version.mjs";
import {
  withPendingSecretBindings,
  inspectSecretBindings,
} from "../../scripts/lib/cloudflare-deployment-bindings.mjs";

describe("production deployment wiring", () => {
  const workflow = parse(readFileSync(".github/workflows/deploy.yml", "utf8"));
  it("starts after main CI and keeps one serialized production rollout", () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: ["CI"],
      types: ["completed"],
      branches: ["main"],
    });
    expect(workflow.concurrency).toEqual({
      group: "deploy-production",
      "cancel-in-progress": false,
    });
    for (const condition of [
      "conclusion == 'success'",
      "event == 'push'",
      "head_branch == 'main'",
      "head_repository.full_name == github.repository",
      "head_sha == github.sha",
    ])
      expect(workflow.jobs.deploy.if).toContain(condition);
    const steps = workflow.jobs.deploy.steps;
    expect(
      steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/checkout@")).with.ref
    ).toBe("${{ env.DEPLOY_TARGET_SHA }}");
    expect(
      steps.find(
        (step: { name?: string }) => step.name === "Verify London release and API contracts"
      ).run
    ).toBe("pnpm run preflight:foundation -- --provisioned-runtime");
  });
  it("uses additive secrets atomically and tags the actual deployed source", () => {
    const step = workflow.jobs.deploy.steps.find(
      (step: { name?: string }) => step.name === "Deploy to Cloudflare"
    );
    expect(step.run).toContain("deploy --env production");
    expect(step.run).toContain('--secrets-file "$RUNNER_TEMP/cloudflare-candidate-secrets.json"');
    expect(step.run).toContain('--tag "$DEPLOY_TARGET_SHA"');
    for (const worker of ["Rate Limiter", "Retention Cleanup", "Payment Cleanup", "Ops Jobs"])
      expect(
        workflow.jobs.deploy.steps.find(
          (step: { name?: string }) => step.name === `Deploy ${worker} Worker`
        ).run
      ).toContain("--secrets-file");
  });
  it("never rolls back part of production automatically and stops for a person instead", () => {
    type Step = {
      id?: string;
      name?: string;
      if?: string;
      run?: string;
      uses?: string;
      with?: Record<string, unknown>;
      "continue-on-error"?: unknown;
    };
    // No workflow step may roll back or shift traffic between Worker versions,
    // whether directly, through an action, or through a helper script.
    const rollbackCommand =
      /\bwrangler\b[^\n]*\b(rollback|versions\s+deploy)\b|\brollback[\w.-]*\.(sh|mjs|cjs|js|ts)\b/i;
    for (const file of readdirSync(".github/workflows")) {
      const parsed = parse(readFileSync(path.join(".github/workflows", file), "utf8"));
      for (const [jobName, job] of Object.entries(parsed.jobs ?? {}) as [
        string,
        { steps?: Step[] },
      ][])
        for (const step of job.steps ?? []) {
          const where = `${file} ${jobName} ${step.name ?? step.uses ?? ""}`;
          expect(step.run ?? "", where).not.toMatch(rollbackCommand);
          expect(JSON.stringify(step.with ?? {}), where).not.toMatch(/rollback|versions\s+deploy/i);
        }
    }
    expect(Object.keys(workflow.jobs)).toEqual(["staging-config", "deploy-staging", "deploy"]);
    const steps = workflow.jobs.deploy.steps as Step[];
    const firstChange = steps.findIndex((step) => step.id === "deploy-monitor");
    const stop = steps.findIndex((step) => step.name === "Stop for manual rollback");
    const health = steps.findIndex((step) => step.id === "health-check");
    expect(firstChange).toBeGreaterThanOrEqual(0);
    expect(health).toBeGreaterThan(firstChange);
    expect(stop).toBeGreaterThan(health);
    // Every step that changes Cloudflare sits between the first change and the stop.
    const changesProduction = (step: Step) =>
      /wrangler\s+(deploy|secret|versions|rollback)|opennextjs-cloudflare\s+(deploy|upload)/.test(
        step.run ?? ""
      ) || /wrangler-action/.test(step.uses ?? "");
    steps.forEach((step, index) => {
      if (changesProduction(step)) {
        expect(index, step.name).toBeGreaterThanOrEqual(firstChange);
        expect(index, step.name).toBeLessThan(stop);
      }
    });
    // Nothing from the first change to the stop may hide a failure.
    for (const step of steps.slice(firstChange, stop + 1))
      expect(step["continue-on-error"], step.name).toBeUndefined();
    expect(steps[stop].if).toBe(
      "(failure() || cancelled()) && steps.deploy-monitor.outcome != 'skipped'"
    );
    expect(steps[stop].run).toContain("Manual rollback needed");
    expect(steps[stop].run).toContain("docs/RUNBOOK.md");
    expect(steps[stop].run).toMatch(/exit 1\s*$/);
    const runbook = readFileSync("docs/RUNBOOK.md", "utf8");
    expect(runbook).toContain("### Manual rollback (all Workers)");
    expect(runbook).toContain("gh workflow disable deploy.yml");
  });
});

describe("staging before production (M0.15b)", () => {
  const workflow = parse(readFileSync(".github/workflows/deploy.yml", "utf8"));
  type Step = { name?: string; run?: string; if?: string; env?: Record<string, string> };
  type Job = {
    if?: string;
    needs?: string[] | string;
    env?: Record<string, string>;
    environment?: string | { name: string };
    steps?: Step[];
  };
  const jobs = workflow.jobs as Record<string, Job>;
  const text = (value: unknown) => JSON.stringify(value);
  const secretsOf = (value: unknown) =>
    [...text(value).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  const wranglerStaging = (
    parseToml(readFileSync("wrangler.toml", "utf8")) as {
      env: { staging: { vars: Record<string, string> } };
    }
  ).env.staging.vars;

  it("makes production wait for staging, but never for a staging copy that is skipped", () => {
    expect(jobs.deploy.needs).toEqual(["staging-config", "deploy-staging"]);
    for (const condition of [
      "!cancelled()",
      "needs.staging-config.result == 'success'",
      "needs.deploy-staging.result == 'success' || needs.deploy-staging.result == 'skipped'",
      // A manual staging-only rehearsal never deploys production.
      "(github.event_name != 'workflow_dispatch' || inputs.environment == 'production')",
    ])
      expect(jobs.deploy.if).toContain(condition);
    expect(workflow.on.workflow_dispatch.inputs.environment.options).toEqual([
      "production",
      "staging",
    ]);
    for (const condition of [
      "conclusion == 'success'",
      "event == 'push'",
      "head_branch == 'main'",
      "head_repository.full_name == github.repository",
      "head_sha == github.sha",
    ])
      expect(jobs["staging-config"].if).toContain(condition);
    expect(jobs["deploy-staging"].needs).toBe("staging-config");
    expect(jobs["deploy-staging"].if).toBe("needs.staging-config.outputs.configured == 'true'");
  });

  it("skips, bypasses or fails staging on purpose, and probes the project first", () => {
    const steps = jobs["staging-config"].steps!;
    const decide = steps[0].run!;
    expect(steps[0].env?.STAGING_BYPASS_UNTIL).toBe("${{ vars.STAGING_BYPASS_UNTIL }}");
    expect(decide).toContain("72 * 3600");
    expect(decide).toContain("Staging skipped");
    // Some but not all secrets set: the release stops.
    expect(decide).toMatch(/Staging half configured[\s\S]*exit 1/);
    // The staging deploy token is mandatory and never replaced by production's.
    expect(decide).toContain('if [ -z "$STAGING_CLOUDFLARE_API_TOKEN" ]');
    const probe = steps.find((step) => step.run?.includes("/auth/v1/health"));
    expect(probe?.run).toContain("Staging project paused/unreachable");
    const keyProbe = steps.find((step) => step.run?.includes("/auth/v1/admin/users"));
    expect(Object.keys(keyProbe?.env ?? {})).toEqual(["STAGING_FOUNDATION_SUPABASE_SECRET_KEY"]);
    expect(keyProbe?.run).not.toMatch(/echo[^\n]*\$STAGING_FOUNDATION_SUPABASE_SECRET_KEY/);
  });

  it("checks for exactly the secrets the staging Worker needs", () => {
    const declared = Object.keys(jobs["staging-config"].steps![0].env!).filter(
      (name) => name !== "STAGING_BYPASS_UNTIL"
    );
    expect(new Set(declared)).toEqual(
      new Set([
        "STAGING_CLOUDFLARE_API_TOKEN",
        ...STAGING_WORKER_SECRETS.map(([name]: [string, string]) => `STAGING_${name}`),
      ])
    );
    const prepare = jobs["deploy-staging"].steps!.find((step) =>
      step.run?.includes("prepare-staging-worker-secrets.mjs")
    );
    expect(new Set(Object.keys(prepare!.env!))).toEqual(
      new Set([
        "CLOUDFLARE_ACCOUNT_ID",
        ...STAGING_WORKER_SECRETS.map(([name]: [string, string]) => `STAGING_${name}`),
      ])
    );
  });

  it("gives staging only STAGING_* secrets, scoped to the steps that need them", () => {
    for (const name of ["staging-config", "deploy-staging"]) {
      const secrets = secretsOf(jobs[name]);
      expect(secrets.length, name).toBeGreaterThan(0);
      for (const secret of secrets)
        expect(
          secret.startsWith("STAGING_") || secret === "CLOUDFLARE_ACCOUNT_ID",
          `${name} uses ${secret}`
        ).toBe(true);
      expect(secretsOf(jobs[name].env), `${name} job-level env`).toEqual([]);
    }
    const deploys = jobs["deploy-staging"].steps!.filter((step) =>
      /wrangler deploy|opennextjs-cloudflare deploy|check-staging-deployed-version/.test(
        step.run ?? ""
      )
    );
    for (const step of deploys)
      expect(step.env?.CLOUDFLARE_API_TOKEN, step.name).toBe(
        "${{ secrets.STAGING_CLOUDFLARE_API_TOKEN }}"
      );
    expect(text(jobs["deploy-staging"].environment)).toContain("staging");
    expect(jobs["deploy-staging"].env?.ENVIRONMENT).toBe("staging");
  });

  it("deploys only staging Workers, checks isolation first and smoke-tests this commit", () => {
    const runs = jobs["deploy-staging"].steps!.map((step) => step.run ?? "");
    const deploys = runs.filter((run) => /wrangler deploy|opennextjs-cloudflare deploy/.test(run));
    expect(deploys).toHaveLength(3);
    for (const run of deploys) expect(run).toContain("--env staging");
    expect(runs.join("\n")).not.toMatch(/--env production|--env=production/);
    const at = (needle: string) => runs.findIndex((run) => run.includes(needle));
    const firstDeploy = runs.findIndex((run) => deploys.includes(run));
    expect(runs[at("cloudflare:staging:isolation")]).toContain("--require-staging");
    expect(at("cloudflare:staging:isolation")).toBeLessThan(firstDeploy);
    expect(at("prepare-staging-worker-secrets.mjs")).toBeLessThan(firstDeploy);
    expect(at("export-cloudflare-public-env.mjs --env=staging")).toBeLessThan(firstDeploy);
    expect(at("check-staging-deployed-version.mjs")).toBeGreaterThan(firstDeploy);
    expect(at("playwright.staging.config.ts")).toBeGreaterThan(
      at("check-staging-deployed-version.mjs")
    );
  });

  it("deploys production's companion Workers to their top-level environment explicitly", () => {
    for (const config of ["wrangler.offload.toml", "wrangler.rate-limiter.toml"]) {
      const step = jobs.deploy.steps!.find((candidate) => candidate.run?.includes(config));
      expect(step?.run, config).toContain('--env=""');
    }
  });

  it("keeps the public staging values in the workflows in step with wrangler.toml", () => {
    const keepalive = parse(readFileSync(".github/workflows/staging-keepalive.yml", "utf8"));
    for (const env of [jobs["staging-config"].env!, keepalive.jobs.keepalive.env]) {
      expect(env.STAGING_SUPABASE_URL).toBe(wranglerStaging.FOUNDATION_SUPABASE_URL);
      expect(env.STAGING_PUBLISHABLE_KEY).toBe(wranglerStaging.FOUNDATION_SUPABASE_PUBLISHABLE_KEY);
    }
    expect(keepalive.on.schedule).toHaveLength(1);
    expect(secretsOf(keepalive)).toEqual([]);
  });

  it("prepares the staging secrets without printing or accepting malformed values", () => {
    const env: Record<string, string> = { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32) };
    const hex = "0123456789abcdef".repeat(4);
    for (const [name, rule] of STAGING_WORKER_SECRETS as [string, string][])
      env[`STAGING_${name}`] =
        rule === "hex64"
          ? hex
          : rule === "supabase-secret"
            ? "sb_secret_" + "s".repeat(24) // secret-scan: allow synthetic shape only
            : rule === "resend"
              ? "re_" + "r".repeat(20) // secret-scan: allow synthetic shape only
              : "x".repeat(40);
    const good = collectStagingSecrets(env);
    expect(good.problems).toEqual([]);
    expect(good.secrets.SUPABASE_SERVICE_ROLE_KEY).toBe(
      good.secrets.FOUNDATION_SUPABASE_SECRET_KEY
    );
    expect(good.secrets.R2_ACCOUNT_ID).toBe(env.CLOUDFLARE_ACCOUNT_ID);
    // Cloudflare's published always-pass Turnstile test secret.
    expect(good.secrets.TURNSTILE_SECRET_KEY).toMatch(/^1x0{31}AA$/);
    const bad = collectStagingSecrets({
      ...env,
      STAGING_HMAC_SECRET: "0".repeat(64),
      STAGING_RESEND_API_KEY: "",
    });
    expect(bad.problems).toEqual([
      "STAGING_HMAC_SECRET is malformed (hex64)",
      "STAGING_RESEND_API_KEY is missing",
    ]);
    expect(JSON.stringify(bad.problems)).not.toContain(hex);
  });

  it("confirms the deployed staging version by its commit tag", () => {
    const sha = "a".repeat(40);
    expect(deployedVersionProblem(["v1"], [{ annotations: { "workers/tag": sha } }], sha)).toBe(
      null
    );
    expect(deployedVersionProblem(["v1"], [{ annotations: {} }], sha)).toMatch(/tagged "\(none\)"/);
    expect(deployedVersionProblem(["v1", "v2"], [], sha)).toMatch(/split over 2 versions/);
  });
});

describe("CI browser installation", () => {
  it("installs the browser test lane's dependencies without the former installer cutoff", () => {
    // The stub suite's e2e-full-matrix was retired; e2e-foundation is the browser lane.
    const job = parse(readFileSync(".github/workflows/e2e-foundation.yml", "utf8")).jobs.browser;
    const install = job.steps.find(
      (step: { uses?: string }) => step.uses === "./.github/actions/install-browsers"
    );
    expect(install).toBeDefined();
    expect(install["timeout-minutes"]).toBeUndefined();
    const action = parse(readFileSync(".github/actions/install-browsers/action.yml", "utf8"));
    expect(action.runs.steps.map((step: { run?: string }) => step.run).join("\n")).toContain(
      "https://archive.ubuntu.com/ubuntu"
    );
    expect(action.runs.steps.at(-1).run).toContain(
      'pnpm exec playwright install --with-deps "${selected_browsers[@]}"'
    );
  });
});

describe("pending deployment secret validation", () => {
  const marker = "synthetic-value-that-must-not-appear-in-reports";
  it("checks new bindings without requiring them in the previous deployment or returning values", () => {
    const pending = withPendingSecretBindings([{ name: "OLD", type: "secret_text" }], {
      NEW: marker,
    });
    expect(inspectSecretBindings(pending, ["OLD", "NEW"], [])).toEqual({
      missing: [],
      unsafe: [],
      forbidden: [],
    });
    expect(JSON.stringify(pending)).not.toContain(marker);
    expect(inspectSecretBindings(pending, ["MISSING"], []).missing).toEqual(["MISSING"]);
  });
  it("does not hide production bypass bindings", () => {
    const pending = withPendingSecretBindings([], { PLAYWRIGHT_TEST_MODE: marker });
    expect(inspectSecretBindings(pending, [], ["PLAYWRIGHT_TEST_MODE"]).forbidden).toEqual([
      "PLAYWRIGHT_TEST_MODE",
    ]);
  });
  it.each([null, [], {}, { KEY: "short" }, { KEY: " " + marker }, { KEY: 12 }])(
    "rejects malformed planned secrets without exposing their contents",
    (value) => {
      expect(() => withPendingSecretBindings([], value)).toThrow("Invalid pending secret bindings");
    }
  );
  it("creates distinct matching app and Worker credentials outside the checkout", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vm-deployment-secrets-"));
    const keys = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "FOUNDATION_SUPABASE_SECRET_KEY",
      "FOUNDATION_PHONE_OTP_KEY",
      "INTERNAL_JOBS_SECRET",
      "OPS_JOBS_SECRET",
      "KYC_WEBHOOK_SECRET",
      "TURNSTILE_SECRET_KEY",
      "HEALTH_DIAGNOSTIC_TOKEN",
      "RATE_LIMITER_API_KEY",
      "SITE_MONITOR_API_KEY",
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GITHUB_ACTIONS: "true",
      RUNNER_TEMP: dir,
      ...Object.fromEntries(
        keys.map((key) => [
          key,
          marker + (key === "SUPABASE_SERVICE_ROLE_KEY" ? "FOUNDATION_SUPABASE_SECRET_KEY" : key),
        ])
      ),
    };
    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/prepare-cloudflare-candidate-secrets.mjs", "--include-workers"],
        { env, encoding: "utf8", windowsHide: true }
      );
      expect(result.status, result.stderr).toBe(0);
      const read = (file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      const app = read("cloudflare-candidate-secrets.json");
      expect(read("cloudflare-cleanup-secrets.json")).toEqual({
        WORKER_API_KEY: app.INTERNAL_JOBS_SECRET, // secret-scan: allow synthetic runtime reference
      });
      expect(read("cloudflare-limiter-secrets.json")).toEqual({
        WORKER_API_KEY: app.RATE_LIMITER_API_KEY, // secret-scan: allow synthetic runtime reference
      });
      expect(read("cloudflare-ops-secrets.json")).toEqual({ OPS_JOBS_SECRET: app.OPS_JOBS_SECRET });
      expect(read("cloudflare-monitor-secrets.json")).toEqual({
        MONITOR_API_KEY: env.SITE_MONITOR_API_KEY,
      });
      expect(app).not.toHaveProperty("SITE_MONITOR_API_KEY");
      expect(result.stdout).not.toContain(marker);
      expect(existsSync(path.join(process.cwd(), "cloudflare-candidate-secrets.json"))).toBe(false);
    } finally {
      expect(path.dirname(path.resolve(dir))).toBe(path.resolve(tmpdir()));
      expect(path.basename(dir)).toMatch(/^vm-deployment-secrets-/);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("public production build settings", () => {
  it("exports only public bindings and rejects a mismatched browser build", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vm-public-build-settings-"));
    const file = path.join(dir, "github-env");
    const marker = "synthetic-private-value-that-must-not-be-exported";
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GITHUB_ACTIONS: "true",
      GITHUB_ENV: file,
      HMAC_SECRET: marker,
    };
    for (const name of Object.keys(env)) if (name.startsWith("NEXT_PUBLIC_")) delete env[name];
    try {
      const run = (changes = {}) =>
        spawnSync(process.execPath, ["scripts/export-cloudflare-public-env.mjs"], {
          env: { ...env, ...changes },
          encoding: "utf8",
          windowsHide: true,
        });
      const good = run();
      expect(good.status, good.stderr).toBe(0);
      const exported = readFileSync(file, "utf8");
      expect(exported).toContain(
        "NEXT_PUBLIC_SUPABASE_URL=https://gntzjtuncsyefujajmjy.supabase.co"
      );
      expect(exported).not.toContain("NEXT_PUBLIC_DATA_BACKEND");
      expect(
        exported
          .split("\n")
          .filter(Boolean)
          .every((line) => line.startsWith("NEXT_PUBLIC_"))
      ).toBe(true);
      expect(exported).not.toContain(marker);
      const bad = run({ NEXT_PUBLIC_SUPABASE_ANON_KEY: marker });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("Build/binding mismatch: NEXT_PUBLIC_SUPABASE_ANON_KEY");
      expect(bad.stderr).not.toContain(marker);
      expect(readFileSync(file, "utf8")).toBe(exported);
    } finally {
      expect(path.dirname(path.resolve(dir))).toBe(path.resolve(tmpdir()));
      expect(path.basename(dir)).toMatch(/^vm-public-build-settings-/);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
