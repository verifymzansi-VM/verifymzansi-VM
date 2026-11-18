// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createCloudflareStartupFixture } from "../../scripts/lib/cloudflare-startup-fixture.mjs";
import { privateBuildNames, productionWorkerVars } from "../../scripts/lib/release-build-env.mjs";
import { CLOUDFLARE_RUNTIME_ONLY_SECRETS } from "@/lib/config/launch-validation";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
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
const secretNames = (value: unknown) =>
  [...JSON.stringify(value ?? {}).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
const label = (step: Step) => step.name ?? step.uses ?? step.run ?? "";

// The only steps allowed to receive secrets. Every other step gets none.
// Add a step here only after checking which values its scripts read.
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
    "Deploy Offload Worker",
    "Deploy to Cloudflare",
    "Deploy Rate Limiter Worker",
    "Deploy Retention Cleanup Worker",
    "Deploy Payment Cleanup Worker",
    "Deploy Ops Jobs Worker",
    "Post-deploy health check",
    "Recheck live project security settings",
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
const ENV_WRITERS = new Set(["Normalize deploy env aliases"]);
// Steps that change Cloudflare: only the Cloudflare credentials, nothing else.
const CLOUDFLARE_ONLY = /^(Deploy |Upload inactive|Validate Cloudflare deploy credentials)/;

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
        // Secrets go through step env only, never pasted into a command.
        expect(usesSecret(step.run), label(step)).toBe(false);
        if (secret && /GITHUB_ENV/.test(step.run ?? ""))
          expect(ENV_WRITERS.has(label(step)), label(step)).toBe(true);
        if (CLOUDFLARE_ONLY.test(label(step)))
          expect(new Set(secretNames(step.env)), label(step)).toEqual(
            new Set(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"])
          );
      }
      for (const name of allowed)
        expect(
          job.steps.some((step) => label(step) === name),
          `${name} exists`
        ).toBe(true);
      const build = job.steps.find((step) => /build-cloudflare-release/.test(step.run ?? ""));
      expect(build, "release build step").toBeDefined();
      expect(build?.env, "release build step env").toBeUndefined();
      expect(build?.run ?? "").not.toMatch(/pnpm run build:cloudflare/);
      expect(job.steps.some((step) => /pnpm run build:cloudflare/.test(step.run ?? ""))).toBe(
        false
      );
    });

    it(`${file} validates with runtime-only keys left in Cloudflare`, () => {
      const job = load(file).jobs[jobName];
      const validate = job.steps.find((step) => /validate-launch-env/.test(step.run ?? ""));
      expect(validate?.run).toContain("--mode=production --runtime-secrets-in-cloudflare");
      // The launch check also compares these values with the test-suite secrets.
      for (const name of ["INTERNAL_JOBS_SECRET", "OPS_JOBS_SECRET", "FOUNDATION_PHONE_OTP_KEY"])
        expect(validate?.env?.[name], name).toBe(`\${{ secrets.${name} }}`);
    });
  }

  it("deploy.yml removes the secret files right after the last deploy step", () => {
    const steps = load("deploy.yml").jobs.deploy.steps;
    const lastWrite = steps.findLastIndex((step) => /--secrets-file/.test(step.run ?? ""));
    const cleanup = steps.findIndex(
      (step) => step.name === "Remove temporary deployment credentials"
    );
    expect(cleanup).toBe(lastWrite + 1);
    expect(steps[cleanup].if).toBe("always()");
    for (const file of [
      "cloudflare-candidate-secrets.json",
      "cloudflare-cleanup-secrets.json",
      "cloudflare-limiter-secrets.json",
      "cloudflare-ops-secrets.json",
      "cloudflare-monitor-secrets.json",
    ])
      expect(steps[cleanup].run).toContain(`"$RUNNER_TEMP/${file}"`);
    const browsers = steps.findIndex((step) => /install-browsers/.test(step.uses ?? ""));
    const health = steps.findIndex((step) => step.name === "Post-deploy health check");
    expect(cleanup).toBeLessThan(health);
    expect(cleanup).toBeLessThan(browsers);
  });

  it("no workflow reads the production runtime-only keys", () => {
    for (const file of readdirSync(".github/workflows")) {
      const text = readFileSync(path.join(".github/workflows", file), "utf8");
      for (const name of CLOUDFLARE_RUNTIME_ONLY_SECRETS)
        expect(text, `${file} ${name}`).not.toMatch(new RegExp(`(^|[^A-Z0-9_])${name}\\b`));
    }
  });

  it("backups use their own protected environment and a bucket-scoped token", () => {
    const backup = load("database-backup.yml").jobs.backup;
    expect(backup.environment).toBe("backup");
    const freshness = load("backup-freshness.yml").jobs["stored-backup"];
    expect(freshness.environment).toBe("backup");
    for (const job of [backup, freshness]) {
      expect(usesSecret(job.env)).toBe(false);
      const storage = job.steps.filter((step) => secretNames(step.env).includes("R2_ACCOUNT_ID"));
      expect(storage).toHaveLength(1);
      expect(secretNames(storage[0].env)).toContain("BACKUP_R2_ACCESS_KEY_ID");
      expect(secretNames(storage[0].env)).toContain("BACKUP_R2_SECRET_ACCESS_KEY");
      // The app's storage key never reaches the AWS CLI's own variable names.
      expect(storage[0].env?.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(storage[0].run).toContain("::warning::Backups still use the app's storage key");
    }
    const text = readFileSync(".github/workflows/database-backup.yml", "utf8");
    expect(text).not.toMatch(/DB_URL=[^\n]*GITHUB_ENV/);
    const password = backup.steps.filter((step) =>
      secretNames(step.env).includes("SUPABASE_BACKUP_DB_PASSWORD")
    );
    expect(password.map((step) => step.name)).toEqual(["Build the database connection string"]);
  });
});

describe("release build", () => {
  const productionVars = productionWorkerVars(
    parseToml(readFileSync("wrangler.toml", "utf8")) as Record<string, unknown>
  );

  it("replaces every private credential with a synthetic value and keeps public settings", () => {
    const names = privateBuildNames(createCloudflareStartupFixture({}), productionVars);
    for (const name of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "FOUNDATION_SUPABASE_SECRET_KEY",
      "FOUNDATION_PHONE_OTP_KEY",
      "INTERNAL_JOBS_SECRET",
      "OPS_JOBS_SECRET",
      "HEALTH_DIAGNOSTIC_TOKEN",
      "RATE_LIMITER_API_KEY",
      "KYC_WEBHOOK_SECRET",
      "KYC_ENCRYPTION_KEY",
      "ID_ENCRYPTION_KEY",
      "HMAC_SECRET",
      "IP_HASH_SECRET",
      "AFRICASTALKING_API_KEY",
      "OZOW_CLIENT_SECRET",
      "OZOW_WEBHOOK_SECRET",
      "RESEND_API_KEY",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "TURNSTILE_SECRET_KEY",
    ])
      expect(names).toContain(name);
    expect(names.some((name) => name.startsWith("NEXT_PUBLIC_"))).toBe(false);
    for (const name of ["FOUNDATION_SUPABASE_URL", "NODE_ENV", "KYC_PROVIDER", "R2_PUBLIC_BUCKET"])
      expect(names).not.toContain(name);
  });

  it("treats only committed non-secret Worker settings as public", () => {
    // wrangler.toml is public; a credential must never be added there.
    for (const name of Object.keys(productionVars)) {
      // Browser-visible keys (publishable, site) are public by design.
      if (name.startsWith("NEXT_PUBLIC_") || name.includes("PUBLISHABLE")) continue;
      expect(name, name).not.toMatch(/SECRET|PASSWORD$|TOKEN|_KEY$/);
    }
  });

  it("refuses to build when a real private or release credential is in its environment", () => {
    const result = spawnSync(process.execPath, ["scripts/build-cloudflare-release.mjs"], {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
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
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("runs only in GitHub Actions");
  });
});
