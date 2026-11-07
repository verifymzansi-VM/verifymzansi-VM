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
const usesSecret = (value: unknown) => /\$\{\{\s*secrets\./.test(JSON.stringify(value ?? {}));
// Steps that run third-party code or dependency scripts and must see no secret.
const mustBeSecretFree = (step: Step) =>
  /pnpm install|playwright install|build-cloudflare-release|build:cloudflare/.test(
    step.run ?? ""
  ) ||
  /^(actions\/(checkout|setup-node|upload-artifact)|pnpm\/action-setup|\.\/\.github\/actions\/install-browsers)/.test(
    step.uses ?? ""
  );

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
    });

    it(`${file} gives install, build, browser and upload steps no secret`, () => {
      const job = load(file).jobs[jobName];
      const checked = job.steps.filter(mustBeSecretFree);
      expect(checked.length).toBeGreaterThanOrEqual(4);
      for (const step of checked) {
        expect(usesSecret(step.env), step.name ?? step.uses).toBe(false);
        expect(usesSecret(step.with), step.name ?? step.uses).toBe(false);
      }
      const build = job.steps.find((step) => /build-cloudflare-release/.test(step.run ?? ""));
      expect(build?.run).not.toMatch(/pnpm run build:cloudflare/);
    });

    it(`${file} validates with runtime-only keys left in Cloudflare`, () => {
      const job = load(file).jobs[jobName];
      const validate = job.steps.find((step) => /validate-launch-env/.test(step.run ?? ""));
      expect(validate?.run).toContain("--mode=production --runtime-secrets-in-cloudflare");
    });
  }

  it("no workflow references the runtime-only keys", () => {
    for (const file of readdirSync(".github/workflows")) {
      const text = readFileSync(path.join(".github/workflows", file), "utf8");
      for (const name of CLOUDFLARE_RUNTIME_ONLY_SECRETS) expect(text, file).not.toContain(name);
    }
  });

  it("backups use their own protected environment and never fall back silently", () => {
    const job = load("database-backup.yml").jobs.backup;
    expect(job.environment).toBe("backup");
    const text = readFileSync(".github/workflows/database-backup.yml", "utf8");
    expect(text).toContain("secrets.BACKUP_DB_ROLE");
    expect(text).toContain("secrets.BACKUP_R2_ACCESS_KEY_ID");
    expect(text).toContain("must be the dedicated read-only backup role, not postgres");
    expect(text).toMatch(/::warning::Backups still use the postgres password/);
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

  it("refuses to build when a real private credential is in its environment", () => {
    const result = spawnSync(process.execPath, ["scripts/build-cloudflare-release.mjs"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        GITHUB_ACTIONS: "true",
        KYC_ENCRYPTION_KEY: "a".repeat(64),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Private credentials must not reach the build step");
    expect(result.stderr).toContain("KYC_ENCRYPTION_KEY");
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
