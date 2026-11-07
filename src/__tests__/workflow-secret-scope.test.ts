// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createCloudflareStartupFixture } from "../../scripts/lib/cloudflare-startup-fixture.mjs";
import { privateBuildNames } from "../../scripts/lib/release-build-env.mjs";
import { CLOUDFLARE_RUNTIME_ONLY_SECRETS } from "@/lib/config/launch-validation";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = { environment?: unknown; env?: Record<string, string>; steps: Step[] };

const load = (file: string) =>
  parse(readFileSync(path.join(".github/workflows", file), "utf8")) as {
    env?: Record<string, string>;
    jobs: Record<string, Job>;
  };
// Any expression that reads the secrets context, whatever the syntax: secrets.X, secrets['X'], toJSON(secrets).
const usesSecret = (value: unknown) => /\$\{\{[^}]*\bsecrets\b/.test(JSON.stringify(value ?? {}));
const label = (step: Step) => step.name ?? step.uses ?? step.run ?? "";

// The only steps allowed to receive secrets. Every other step gets none.
const SECRET_STEPS: Record<string, string[]> = {
  "deploy.yml": [
    "Normalize deploy env aliases",
    "Verify London release and API contracts",
    "Match public build settings to production bindings",
    "Validate production launch env",
    "Enforce production Ozow mode",
    "Validate Cloudflare deploy credentials",
    "Verify Cloudflare Worker secrets before deploy",
    "Deploy authenticated service monitor",
    "Deploy to Cloudflare",
    "Deploy Rate Limiter Worker",
    "Deploy Retention Cleanup Worker",
    "Deploy Payment Cleanup Worker",
    "Deploy Ops Jobs Worker",
    "Post-deploy health check",
  ],
  "cloudflare-candidate.yml": [
    "Match all public build settings to production bindings",
    "Verify hosted connection and candidate contracts",
    "Validate production configuration",
    "Prepare additive scoped bindings",
    "Upload inactive production candidate",
  ],
};
// Secret-bearing steps that may write to $GITHUB_ENV (public values only).
const ENV_WRITERS = new Set([
  "Normalize deploy env aliases",
  "Match public build settings to production bindings",
  "Match all public build settings to production bindings",
]);

describe("production secrets reach only the steps that use them", () => {
  for (const [file, jobName] of [
    ["deploy.yml", "deploy"],
    ["cloudflare-candidate.yml", "upload"],
  ] as const) {
    it(`${file} binds the protected environment and sets no secret at job or workflow level`, () => {
      const workflow = load(file);
      const job = workflow.jobs[jobName];
      expect(job.environment).toBe("production");
      expect(usesSecret(workflow.env)).toBe(false);
      expect(usesSecret(job.env)).toBe(false);
      expect(job.env?.CLOUDFLARE_BUILD_HOOK).toBe("verify-only");
    });

    it(`${file} gives secrets only to the reviewed steps`, () => {
      const job = load(file).jobs[jobName];
      const allowed = new Set(SECRET_STEPS[file]);
      for (const step of job.steps) {
        const secret = usesSecret(step.env) || usesSecret(step.with) || usesSecret(step.run);
        if (!allowed.has(label(step))) expect(secret, label(step)).toBe(false);
        if (secret && /GITHUB_ENV/.test(step.run ?? ""))
          expect(ENV_WRITERS.has(label(step)), label(step)).toBe(true);
      }
      for (const name of allowed)
        expect(
          job.steps.some((step) => label(step) === name),
          `${name} exists`
        ).toBe(true);
      const build = job.steps.find((step) => /build-cloudflare-release/.test(step.run ?? ""));
      expect(build, "release build step").toBeDefined();
      expect(build?.run ?? "").not.toMatch(/pnpm run build:cloudflare/);
    });

    it(`${file} validates with runtime-only keys left in Cloudflare`, () => {
      const job = load(file).jobs[jobName];
      const validate = job.steps.find((step) => /validate-launch-env/.test(step.run ?? ""));
      expect(validate?.run).toContain("--mode=production --runtime-secrets-in-cloudflare");
    });
  }

  it("deploy.yml removes the secret files before later steps run", () => {
    const steps = load("deploy.yml").jobs.deploy.steps;
    const lastWrite = steps.findLastIndex((step) => /--secrets-file/.test(step.run ?? ""));
    const cleanup = steps.findIndex((step) => step.name === "Remove deployment secret files");
    expect(cleanup).toBe(lastWrite + 1);
    expect(steps[cleanup].run).toContain('"$RUNNER_TEMP"/cloudflare-*-secrets.json');
    const browsers = steps.findIndex((step) => /install-browsers/.test(step.uses ?? ""));
    expect(cleanup).toBeLessThan(browsers);
  });

  it("no workflow references the runtime-only keys", () => {
    for (const file of readdirSync(".github/workflows")) {
      const text = readFileSync(path.join(".github/workflows", file), "utf8");
      for (const name of CLOUDFLARE_RUNTIME_ONLY_SECRETS) expect(text, file).not.toContain(name);
    }
  });

  it("backups use their own protected environment and keep the connection string in one step", () => {
    const job = load("database-backup.yml").jobs.backup;
    expect(job.environment).toBe("backup");
    const text = readFileSync(".github/workflows/database-backup.yml", "utf8");
    expect(text).not.toMatch(/DB_URL=[^\n]*GITHUB_ENV/);
    const dump = job.steps.find((step) => step.name === "Dump roles, schema and data");
    expect(dump?.env?.DB_PASSWORD).toContain("secrets.SUPABASE_BACKUP_DB_PASSWORD");
    expect(text).toContain("secrets.BACKUP_R2_ACCESS_KEY_ID");
    expect(text).toMatch(/::warning::Backups still use the app's storage key/);
  });
});

describe("release build", () => {
  it("replaces every private credential with a synthetic value and keeps public settings", () => {
    const names = privateBuildNames(createCloudflareStartupFixture({}));
    for (const name of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "FOUNDATION_SUPABASE_SECRET_KEY",
      "KYC_ENCRYPTION_KEY",
      "ID_ENCRYPTION_KEY",
      "HMAC_SECRET",
      "IP_HASH_SECRET",
      "OZOW_CLIENT_SECRET",
      "R2_SECRET_ACCESS_KEY",
      "TURNSTILE_SECRET_KEY",
    ])
      expect(names).toContain(name);
    expect(names.some((name) => name.startsWith("NEXT_PUBLIC_"))).toBe(false);
    expect(names).not.toContain("FOUNDATION_SUPABASE_URL");
    expect(names).not.toContain("NODE_ENV");
  });

  it("refuses to build when a real private or release credential is in its environment", () => {
    const result = spawnSync(process.execPath, ["scripts/build-cloudflare-release.mjs"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        GITHUB_ACTIONS: "true",
        KYC_ENCRYPTION_KEY: "a".repeat(64),
        CLOUDFLARE_API_TOKEN: "synthetic-token",
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Private credentials must not reach the build step");
    expect(result.stderr).toContain("KYC_ENCRYPTION_KEY");
    expect(result.stderr).toContain("CLOUDFLARE_API_TOKEN");
  });

  it("runs only in GitHub Actions", () => {
    const result = spawnSync(process.execPath, ["scripts/build-cloudflare-release.mjs"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("runs only in GitHub Actions");
  });
});
