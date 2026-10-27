import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
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
    ).toBe("pnpm run preflight:foundation");
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
});

describe("CI browser installation", () => {
  const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  it("keeps every browser test lane and installs its dependencies without the former installer cutoff", () => {
    for (const name of ["e2e-smoke", "launch-flows-bundle", "e2e-full-matrix"]) {
      const job = workflow.jobs[name];
      const install = job.steps.find(
        (step: { uses?: string }) => step.uses === "./.github/actions/install-browsers"
      );
      expect(install).toBeDefined();
      expect(install["timeout-minutes"]).toBeUndefined();
    }
    expect(workflow.jobs["e2e-full-matrix"].strategy.matrix.project).toContain("firefox");
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
    ];
    const env = {
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
      expect(exported).toContain("NEXT_PUBLIC_DATA_BACKEND=foundation");
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
