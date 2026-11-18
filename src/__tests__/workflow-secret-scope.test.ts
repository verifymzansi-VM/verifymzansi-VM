// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createCloudflareStartupFixture } from "../../scripts/lib/cloudflare-startup-fixture.mjs";
import {
  RUNNER_BASICS,
  privateBuildNames,
  productionWorkerVars,
  releaseBuildEnvironment,
} from "../../scripts/lib/release-build-env.mjs";
import { CLOUDFLARE_RUNTIME_ONLY_SECRETS } from "@/lib/config/launch-validation";

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: unknown;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};
type Job = { environment?: unknown; env?: Record<string, unknown>; steps?: Step[] } & Record<
  string,
  unknown
>;
type Workflow = { jobs: Record<string, Job> } & Record<string, unknown>;

const WORKFLOWS = ".github/workflows";
const load = (file: string) => parse(readFileSync(path.join(WORKFLOWS, file), "utf8")) as Workflow;
const label = (step: Step) => step.id ?? step.name ?? step.uses ?? step.run ?? "";

/**
 * Every GitHub expression in a value: each `${{ ... }}` segment of every
 * string (string literals may hold braces), and every `if:` as a whole.
 */
function expressions(value: unknown, key = ""): string[] {
  if (typeof value === "string") {
    const found = key === "if" ? [value] : [];
    let start = value.indexOf("${{");
    while (start !== -1) {
      let end = start + 3;
      let quoted = false;
      for (; end < value.length; end++) {
        if (value[end] === "'") {
          if (quoted && value[end + 1] === "'") end++;
          else quoted = !quoted;
        } else if (!quoted && value.startsWith("}}", end)) break;
      }
      found.push(value.slice(start + 3, end));
      start = value.indexOf("${{", end);
    }
    return found;
  }
  if (Array.isArray(value)) return value.flatMap((item) => expressions(item));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([name, item]) => [
      ...expressions(name),
      ...expressions(item, name),
    ]);
  return [];
}
// The secrets context in any syntax or case: secrets.X, secrets['X'], toJSON(secrets), Secrets.x.
const readsSecrets = (value: unknown, key = "") =>
  expressions(value, key).some((expression) =>
    /\bsecrets\b/i.test(expression.replace(/'(?:[^']|'')*'/g, "''"))
  );
// The only accepted form: a whole step env value naming upper-case secrets.
const STEP_SECRET =
  /^\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)((?:\s*\|\|\s*secrets\.[A-Z][A-Z0-9_]*)*)\s*\}\}$/;
function stepSecretNames(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const match = STEP_SECRET.exec(value);
  return match ? [...value.matchAll(/secrets\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]) : null;
}

type Allow = Record<string, { environment: string | null; steps: Record<string, string[]> }>;
const CLOUDFLARE = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"];
const STAGING_WORKER = [
  "STAGING_AFRICASTALKING_API_KEY",
  "STAGING_FOUNDATION_PHONE_OTP_KEY",
  "STAGING_FOUNDATION_SUPABASE_SECRET_KEY",
  "STAGING_HEALTH_DIAGNOSTIC_TOKEN",
  "STAGING_HMAC_SECRET",
  "STAGING_ID_ENCRYPTION_KEY",
  "STAGING_INTERNAL_JOBS_SECRET",
  "STAGING_IP_HASH_SECRET",
  "STAGING_KYC_ENCRYPTION_KEY",
  "STAGING_OPS_JOBS_SECRET",
  "STAGING_R2_ACCESS_KEY_ID",
  "STAGING_R2_SECRET_ACCESS_KEY",
  "STAGING_RATE_LIMITER_API_KEY",
  "STAGING_RESEND_API_KEY",
];
const SUPABASE = [
  "FOUNDATION_PROJECT_REF",
  "FOUNDATION_SUPABASE_PUBLISHABLE_KEY",
  "FOUNDATION_SUPABASE_SECRET_KEY",
  "FOUNDATION_SUPABASE_URL",
];
// What the launch check validates, plus the job secrets it compares with the
// known test-suite secrets.
const LAUNCH_CHECK = [
  "AFRICASTALKING_API_KEY",
  "AFRICASTALKING_SENDER_ID",
  "AFRICASTALKING_USERNAME",
  "FOUNDATION_PHONE_OTP_KEY",
  "FOUNDATION_SUPABASE_SECRET_KEY",
  "INTERNAL_JOBS_SECRET",
  "KYC_WEBHOOK_SECRET",
  "OPS_JOBS_SECRET",
  "OZOW_CLIENT_ID",
  "OZOW_CLIENT_SECRET",
  "OZOW_ENV",
  "OZOW_PAYMENT_OAUTH_SCOPE",
  "OZOW_SITE_CODE",
  "OZOW_WEBHOOK_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_SECRET_ACCESS_KEY",
  "RATE_LIMITER_API_KEY",
  "RESEND_API_KEY",
  "TURNSTILE_SECRET_KEY",
];
// scripts/prepare-cloudflare-candidate-secrets.mjs installs these on the Worker.
const WORKER_BINDINGS = [
  "FOUNDATION_PHONE_OTP_KEY",
  "FOUNDATION_SUPABASE_SECRET_KEY",
  "HEALTH_DIAGNOSTIC_TOKEN",
  "INTERNAL_JOBS_SECRET",
  "KYC_WEBHOOK_SECRET",
  "OPS_JOBS_SECRET",
  "RATE_LIMITER_API_KEY",
  "TURNSTILE_SECRET_KEY",
];
const BACKUP_STORAGE = [
  "BACKUP_R2_ACCESS_KEY_ID",
  "BACKUP_R2_SECRET_ACCESS_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_SECRET_ACCESS_KEY",
];

// Every job in these workflows, its environment, and the only steps (by id)
// allowed secrets, each pinned to its exact set of secret names. Add or widen
// an entry only after checking which values the step's scripts read.
const ALLOWED: Record<string, Allow> = {
  "deploy.yml": {
    "staging-config": {
      environment: "staging",
      steps: {
        decide: ["STAGING_CLOUDFLARE_API_TOKEN", ...STAGING_WORKER],
        "staging-key-probe": ["STAGING_FOUNDATION_SUPABASE_SECRET_KEY"],
      },
    },
    "deploy-staging": {
      environment: "staging",
      steps: {
        "staging-secrets": ["CLOUDFLARE_ACCOUNT_ID", ...STAGING_WORKER],
        "staging-build": ["STAGING_FOUNDATION_SUPABASE_SECRET_KEY"],
        "staging-offload": ["CLOUDFLARE_ACCOUNT_ID", "STAGING_CLOUDFLARE_API_TOKEN"],
        "staging-website": ["CLOUDFLARE_ACCOUNT_ID", "STAGING_CLOUDFLARE_API_TOKEN"],
        "staging-limiter": ["CLOUDFLARE_ACCOUNT_ID", "STAGING_CLOUDFLARE_API_TOKEN"],
        "staging-version": ["CLOUDFLARE_ACCOUNT_ID", "STAGING_CLOUDFLARE_API_TOKEN"],
      },
    },
    deploy: {
      environment: "production",
      steps: {
        "normalize-env": [
          "APP_URL",
          "FOUNDATION_SUPABASE_URL",
          "KYC_PROVIDER",
          "NEXT_PUBLIC_APP_URL",
          "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
          "PRODUCTION_APP_URL",
          "TURNSTILE_SITE_KEY",
        ],
        preflight: SUPABASE,
        "public-settings": ["FOUNDATION_SUPABASE_PUBLISHABLE_KEY"],
        "validate-launch-env": LAUNCH_CHECK,
        "ozow-mode": ["OZOW_ENV"],
        "cloudflare-credentials": CLOUDFLARE,
        "worker-secrets": [...CLOUDFLARE, ...WORKER_BINDINGS, "SITE_MONITOR_API_KEY"],
        "deploy-monitor": CLOUDFLARE,
        "deploy-offload": CLOUDFLARE,
        "deploy-website": CLOUDFLARE,
        "deploy-limiter": CLOUDFLARE,
        "deploy-retention": CLOUDFLARE,
        "deploy-payment-cleanup": CLOUDFLARE,
        "deploy-ops-jobs": CLOUDFLARE,
        "health-check": [
          ...CLOUDFLARE,
          ...SUPABASE,
          "DEPLOY_HEALTHCHECK_URL",
          "RATE_LIMITER_API_KEY",
          "SITE_MONITOR_API_KEY",
        ],
        "security-settings": ["FOUNDATION_SUPABASE_PUBLISHABLE_KEY", "FOUNDATION_SUPABASE_URL"],
      },
    },
  },
  "cloudflare-candidate.yml": {
    upload: {
      environment: "production",
      steps: {
        "public-settings": [
          "APP_URL",
          "FOUNDATION_SUPABASE_PUBLISHABLE_KEY",
          "FOUNDATION_SUPABASE_URL",
          "TURNSTILE_SITE_KEY",
        ],
        "candidate-contracts": SUPABASE,
        "validate-launch-env": [...LAUNCH_CHECK, "KYC_PROVIDER"],
        "prepare-bindings": WORKER_BINDINGS,
        "upload-candidate": CLOUDFLARE,
      },
    },
  },
  "database-backup.yml": {
    backup: {
      environment: "backup",
      steps: {
        "db-url": ["SUPABASE_BACKUP_DB_PASSWORD"],
        upload: BACKUP_STORAGE,
        heartbeat: ["HEARTBEAT_URL_DATABASE_BACKUP"],
      },
    },
  },
  "backup-freshness.yml": {
    "stored-backup": { environment: "backup", steps: { "newest-backup": BACKUP_STORAGE } },
    "schedule-pause": { environment: null, steps: {} },
  },
};
// Jobs that build or deploy the production Worker: the build hook may only verify.
const RELEASE_JOBS: Record<string, string> = {
  "deploy.yml": "deploy",
  "cloudflare-candidate.yml": "upload",
};

const environmentName = (value: unknown) =>
  value === undefined
    ? null
    : typeof value === "string"
      ? value
      : String((value as { name?: unknown }).name);

/** Every way a workflow file departs from its allow-list; empty when it complies. */
function secretScopeProblems(file: string, workflow: Workflow, allowed: Allow): string[] {
  const problems: string[] = [];
  const { jobs, ...top } = workflow;
  if (readsSecrets(top)) problems.push(`${file}: secrets outside jobs`);
  const jobIds = Object.keys(jobs ?? {});
  for (const jobId of jobIds)
    if (!(jobId in allowed)) problems.push(`${file}: job ${jobId} is not in the allow-list`);
  for (const jobId of Object.keys(allowed))
    if (!jobIds.includes(jobId)) problems.push(`${file}: job ${jobId} is missing`);
  for (const jobId of jobIds.filter((id) => id in allowed)) {
    const where = `${file} ${jobId}`;
    const { steps = [], ...jobRest } = jobs[jobId];
    const rule = allowed[jobId];
    if (environmentName(jobRest.environment) !== rule.environment)
      problems.push(`${where}: environment is not ${rule.environment}`);
    for (const [key, value] of Object.entries(jobRest))
      if (readsSecrets(value, key)) problems.push(`${where}: secrets at job level (${key})`);
    // `secrets: inherit` (or a secrets map) hands values to a called workflow.
    if ("secrets" in jobRest) problems.push(`${where}: passes secrets to a reusable workflow`);
    const ids = steps.flatMap((step) => (step.id ? [step.id] : []));
    const names = steps.flatMap((step) => (step.name ? [step.name] : []));
    for (const [kind, list] of [
      ["id", ids],
      ["name", names],
    ] as const)
      for (const duplicate of new Set(list.filter((item, i) => list.indexOf(item) !== i)))
        problems.push(`${where}: duplicate step ${kind} ${duplicate}`);
    for (const step of steps) {
      const declared: string[] = [];
      const rest: Record<string, unknown> = { ...step, env: {} };
      for (const [key, value] of Object.entries(step.env ?? {})) {
        const found = stepSecretNames(value);
        if (found) declared.push(...found);
        else (rest.env as Record<string, unknown>)[key] = value;
      }
      if (Object.entries(rest).some(([key, value]) => readsSecrets(value, key)))
        problems.push(`${where} ${label(step)}: secrets outside a plain step env value`);
      if (declared.length === 0) continue;
      const expected = step.id ? rule.steps[step.id] : undefined;
      if (!expected) {
        problems.push(`${where} ${label(step)}: step is not allowed secrets`);
        continue;
      }
      const actual = [...new Set(declared)].sort().join(" ");
      if (actual !== [...new Set(expected)].sort().join(" "))
        problems.push(`${where} ${step.id}: reads ${actual}`);
    }
    for (const id of Object.keys(rule.steps))
      if (!ids.includes(id)) problems.push(`${where}: allowed step ${id} is missing`);
    if (RELEASE_JOBS[file] === jobId) {
      if (
        (jobRest.env as Record<string, unknown> | undefined)?.CLOUDFLARE_BUILD_HOOK !==
        "verify-only"
      )
        problems.push(`${where}: CLOUDFLARE_BUILD_HOOK is not verify-only`);
      for (const step of steps)
        if (/CLOUDFLARE_BUILD_HOOK/.test(JSON.stringify({ ...step, name: "" })))
          problems.push(`${where} ${label(step)}: changes CLOUDFLARE_BUILD_HOOK`);
    }
  }
  return problems;
}

describe("production secrets reach only the steps that use them", () => {
  for (const file of Object.keys(ALLOWED))
    it(`${file}: every job and step matches the allow-list`, () => {
      expect(secretScopeProblems(file, load(file), ALLOWED[file])).toEqual([]);
    });

  describe("the check itself catches each way around it", () => {
    const deploy = () => structuredClone(load("deploy.yml"));
    const problemsOf = (workflow: Workflow) =>
      secretScopeProblems("deploy.yml", workflow, ALLOWED["deploy.yml"]);
    const step = (workflow: Workflow, id: string) =>
      workflow.jobs.deploy.steps!.find((candidate) => candidate.id === id)!;

    it.each([
      ["format() at job level", "${{ format('{0}', secrets.FOUNDATION_SUPABASE_SECRET_KEY) }}"],
      ["secrets['X'] at job level", "${{ secrets['FOUNDATION_SUPABASE_SECRET_KEY'] }}"],
      ["toJSON(secrets) at job level", "${{ toJSON(secrets) }}"],
    ])("%s", (_label, value) => {
      const workflow = deploy();
      workflow.jobs.deploy.env!.LEAK = value;
      expect(problemsOf(workflow)).toContain("deploy.yml deploy: secrets at job level (env)");
    });

    it.each([
      ["secrets['X']", "${{ secrets['OZOW_CLIENT_SECRET'] }}"],
      ["a lower-case name", "${{ secrets.ozow_client_secret }}"],
      ["a capitalised context", "${{ Secrets.OZOW_CLIENT_SECRET }}"],
      ["format()", "${{ format('{0}}', secrets.OZOW_CLIENT_SECRET) }}"],
    ])("an allowed step reading %s", (_label, value) => {
      const workflow = deploy();
      step(workflow, "ozow-mode").env!.EXTRA = value;
      expect(problemsOf(workflow)).toContain(
        "deploy.yml deploy ozow-mode: secrets outside a plain step env value"
      );
    });

    it("an allowed step reading one more secret than pinned", () => {
      const workflow = deploy();
      step(workflow, "ozow-mode").env!.EXTRA = "${{ secrets.OZOW_CLIENT_SECRET }}";
      expect(problemsOf(workflow)).toContain(
        "deploy.yml deploy ozow-mode: reads OZOW_CLIENT_SECRET OZOW_ENV"
      );
    });

    it("secrets in a command, an `if:` or an action input", () => {
      for (const mutate of [
        (s: Step) => (s.run = "echo ${{ secrets.OZOW_ENV }}"),
        (s: Step) => (s.if = "secrets.OZOW_ENV != ''"),
        (s: Step) => (s.with = { token: "${{ secrets.OZOW_ENV }}" }),
      ]) {
        const workflow = deploy();
        mutate(step(workflow, "ozow-mode"));
        expect(problemsOf(workflow)).toContain(
          "deploy.yml deploy ozow-mode: secrets outside a plain step env value"
        );
      }
    });

    it("a duplicate step reusing an allowed id or name", () => {
      const workflow = deploy();
      const copy = { ...step(workflow, "deploy-website"), run: "curl https://example.invalid" };
      workflow.jobs.deploy.steps!.push(copy);
      const problems = problemsOf(workflow);
      expect(problems).toContain("deploy.yml deploy: duplicate step id deploy-website");
      expect(problems).toContain("deploy.yml deploy: duplicate step name Deploy to Cloudflare");
      const unnamed = deploy();
      unnamed.jobs.deploy.steps!.push({
        name: "Deploy to Cloudflare",
        env: { CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}" },
        run: "true",
      });
      expect(problemsOf(unnamed)).toEqual([
        "deploy.yml deploy: duplicate step name Deploy to Cloudflare",
        "deploy.yml deploy Deploy to Cloudflare: step is not allowed secrets",
      ]);
    });

    it("a step that is not allowed secrets, and a new job", () => {
      const workflow = deploy();
      step(workflow, "public-verify").env!.TOKEN = "${{ secrets.CLOUDFLARE_API_TOKEN }}";
      workflow.jobs.extra = {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "true", env: { T: "${{ secrets.CLOUDFLARE_API_TOKEN }}" } }],
      };
      const problems = problemsOf(workflow);
      expect(problems).toContain("deploy.yml deploy public-verify: step is not allowed secrets");
      expect(problems).toContain("deploy.yml: job extra is not in the allow-list");
    });

    it("a changed environment, or secrets outside jobs", () => {
      const workflow = deploy();
      workflow.jobs.deploy.environment = "staging";
      (workflow as Record<string, unknown>).env = { LEAK: "${{ secrets.OZOW_ENV }}" };
      const problems = problemsOf(workflow);
      expect(problems).toContain("deploy.yml deploy: environment is not production");
      expect(problems).toContain("deploy.yml: secrets outside jobs");
    });

    it("a step that overrides the build hook", () => {
      const workflow = deploy();
      step(workflow, "deploy-website").env!.CLOUDFLARE_BUILD_HOOK = "";
      expect(problemsOf(workflow)).toContain(
        "deploy.yml deploy deploy-website: changes CLOUDFLARE_BUILD_HOOK"
      );
      const viaFile = deploy();
      step(viaFile, "deploy-website").run = 'echo "CLOUDFLARE_BUILD_HOOK=" >> "$GITHUB_ENV"';
      expect(problemsOf(viaFile)).toContain(
        "deploy.yml deploy deploy-website: changes CLOUDFLARE_BUILD_HOOK"
      );
    });
  });

  for (const [file, jobName] of Object.entries(RELEASE_JOBS)) {
    it(`${file} builds with the release build and validates with runtime-only keys left in Cloudflare`, () => {
      const steps = load(file).jobs[jobName].steps!;
      const build = steps.filter((step) => /build-cloudflare-release/.test(step.run ?? ""));
      expect(build).toHaveLength(1);
      expect(build[0].env).toBeUndefined();
      expect(steps.some((step) => /build:cloudflare/.test(step.run ?? ""))).toBe(false);
      const validate = steps.find((step) => step.id === "validate-launch-env");
      expect(validate?.run).toContain("--mode=production --runtime-secrets-in-cloudflare");
    });
  }

  it("deploy.yml removes the secret files right after the last deploy step", () => {
    const steps = load("deploy.yml").jobs.deploy.steps!;
    const lastWrite = steps.findLastIndex((step) => /--secrets-file/.test(step.run ?? ""));
    const cleanup = steps.findIndex(
      (step) => step.name === "Remove temporary deployment credentials"
    );
    expect(cleanup).toBe(lastWrite + 1);
    expect(steps[cleanup].if).toBe("always()");
    for (const name of [
      "cloudflare-candidate-secrets.json",
      "cloudflare-cleanup-secrets.json",
      "cloudflare-limiter-secrets.json",
      "cloudflare-ops-secrets.json",
      "cloudflare-monitor-secrets.json",
    ])
      expect(steps[cleanup].run).toContain(`"$RUNNER_TEMP/${name}"`);
    const browsers = steps.findIndex((step) => /install-browsers/.test(step.uses ?? ""));
    const health = steps.findIndex((step) => step.id === "health-check");
    expect(cleanup).toBeLessThan(health);
    expect(cleanup).toBeLessThan(browsers);
  });

  it("no workflow reads the production runtime-only keys", () => {
    for (const file of readdirSync(WORKFLOWS)) {
      // Whole identifiers only, so STAGING_KYC_ENCRYPTION_KEY does not count.
      const words = new Set(readFileSync(path.join(WORKFLOWS, file), "utf8").match(/\w+/g));
      for (const name of CLOUDFLARE_RUNTIME_ONLY_SECRETS)
        expect(words.has(name), `${file} ${name}`).toBe(false);
    }
  });

  it("backups never hand the app's storage key to the AWS CLI directly", () => {
    for (const [file, jobName] of [
      ["database-backup.yml", "backup"],
      ["backup-freshness.yml", "stored-backup"],
    ]) {
      const storage = load(file).jobs[jobName].steps!.find((step) =>
        ["upload", "newest-backup"].includes(step.id ?? "")
      )!;
      expect(storage.env?.AWS_ACCESS_KEY_ID, file).toBeUndefined();
      expect(storage.env?.LEGACY_R2_ACCESS_KEY_ID, file).toBe("${{ secrets.R2_ACCESS_KEY_ID }}");
      expect(storage.run, file).toContain("::warning::Backups still use the app's storage key");
    }
  });
});

// Every workflow file: only the reviewed jobs may name the protected
// environments, and no job may hand secrets to a called workflow.
const PROTECTED_ENVIRONMENTS = new Set(["production", "backup"]);
function protectedEnvironmentProblems(files: Record<string, Workflow>): string[] {
  const problems: string[] = [];
  for (const [file, workflow] of Object.entries(files))
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      const where = `${file} ${jobId}`;
      if ("secrets" in job) problems.push(`${where}: passes secrets to a reusable workflow`);
      const name = environmentName(job.environment);
      if (name === null) continue;
      // GitHub compares environment names without case; an expression could name any.
      if (name.includes("${{")) problems.push(`${where}: environment chosen by an expression`);
      const reviewed = ALLOWED[file]?.[jobId]?.environment;
      if (PROTECTED_ENVIRONMENTS.has(name.trim().toLowerCase()) && reviewed !== name)
        problems.push(`${where}: names the protected environment ${name}`);
    }
  return problems;
}
const allWorkflows = () =>
  Object.fromEntries(readdirSync(WORKFLOWS).map((file) => [file, load(file)])) as Record<
    string,
    Workflow
  >;

describe("protected environments across every workflow", () => {
  it("only the reviewed jobs name production or backup, and none passes secrets on", () => {
    expect(protectedEnvironmentProblems(allWorkflows())).toEqual([]);
  });

  it("catches a new job, in any workflow, that names a protected environment", () => {
    for (const environment of [
      "production",
      "Production",
      { name: "backup", url: "https://example.invalid" },
      "${{ 'production' }}",
    ]) {
      const files = allWorkflows();
      files["ci.yml"].jobs.sneaky = { "runs-on": "ubuntu-latest", environment, steps: [] };
      expect(protectedEnvironmentProblems(files).join("\n"), JSON.stringify(environment)).toMatch(
        /ci\.yml sneaky: (names the protected environment|environment chosen by an expression)/
      );
    }
  });

  it("catches a job that calls another workflow with inherited or mapped secrets", () => {
    for (const secrets of ["inherit", { TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}" }]) {
      const files = allWorkflows();
      files["deploy.yml"].jobs.deploy = {
        uses: "./.github/workflows/x.yml",
        secrets,
      } as unknown as Job;
      expect(protectedEnvironmentProblems(files)).toContain(
        "deploy.yml deploy: passes secrets to a reusable workflow"
      );
      expect(
        secretScopeProblems("deploy.yml", files["deploy.yml"], ALLOWED["deploy.yml"])
      ).toContain("deploy.yml deploy: passes secrets to a reusable workflow");
      const elsewhere = allWorkflows();
      elsewhere["ci.yml"].jobs.called = {
        uses: "./.github/workflows/x.yml",
        secrets,
      } as unknown as Job;
      expect(protectedEnvironmentProblems(elsewhere)).toContain(
        "ci.yml called: passes secrets to a reusable workflow"
      );
    }
  });
});

describe("where each secret lives (docs/RUNBOOK.md, 'Where secrets live')", () => {
  // Which environments read each secret, across every workflow. The backup
  // jobs' transitional fallback to the app's storage key does not count: it
  // stops resolving, as intended, once that key moves to `production`.
  const readers = new Map<string, Set<string>>();
  for (const file of readdirSync(WORKFLOWS)) {
    for (const job of Object.values(load(file).jobs ?? {})) {
      const where = environmentName(job.environment) ?? "repository";
      const counted = structuredClone(job);
      for (const step of counted.steps ?? [])
        for (const key of Object.keys(step.env ?? {}))
          if (key.startsWith("LEGACY_")) delete step.env![key];
      for (const [, name] of JSON.stringify(counted).matchAll(/secrets\.([A-Z][A-Z0-9_]*)/g)) {
        if (name === "GITHUB_TOKEN") continue;
        readers.set(name, new Set([...(readers.get(name) ?? []), where]));
      }
    }
  }
  const home = (name: string) => {
    const places = [...readers.get(name)!];
    return places.length === 1 && places[0] !== "repository" ? places[0] : "repository";
  };
  const runbook = readFileSync("docs/RUNBOOK.md", "utf8");
  const listed = (place: string) => {
    const open = `<!-- secrets:${place} -->`;
    const start = runbook.indexOf(open);
    const end = runbook.indexOf(`<!-- /secrets:${place} -->`, start);
    expect(start, place).toBeGreaterThanOrEqual(0);
    expect(end, place).toBeGreaterThan(start);
    return [...runbook.slice(start + open.length, end).matchAll(/`([A-Z][A-Z0-9_]*)`/g)]
      .map((match) => match[1])
      .sort();
  };

  for (const place of ["production", "backup", "repository"])
    it(`lists exactly the secrets whose only home is ${place}`, () => {
      const expected = [...readers.keys()].filter((name) => home(name) === place).sort();
      expect(listed(place)).toEqual(expected);
    });

  it("keeps the account identifiers and shared monitoring values at repository level", () => {
    for (const name of [
      "CLOUDFLARE_ACCOUNT_ID",
      "R2_ACCOUNT_ID",
      "SITE_MONITOR_API_KEY",
      "PRODUCTION_APP_URL",
    ])
      expect(home(name), name).toBe("repository");
  });
});

describe("release build", () => {
  const productionVars = productionWorkerVars(
    parseToml(readFileSync("wrangler.toml", "utf8")) as Record<string, unknown>
  );
  const runnerEnv = { PATH: "/usr/bin", HOME: "/home/runner", GITHUB_ACTIONS: "true", CI: "true" };
  const publicFromWrangler = Object.fromEntries(
    Object.entries(productionVars).filter(([name]) => name.startsWith("NEXT_PUBLIC_"))
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
    for (const [name, value] of Object.entries(productionVars)) {
      expect(value, name).not.toMatch(/sb_secret_/i);
      // Browser-visible keys (publishable, site) are public by design.
      if (name.startsWith("NEXT_PUBLIC_") || name.includes("PUBLISHABLE")) continue;
      expect(name, name).not.toMatch(/SECRET|PASSWORD$|TOKEN|_KEY$/);
    }
  });

  it("passes on nothing from the step except runner basics", () => {
    const { problems, environment } = releaseBuildEnvironment(
      {
        ...runnerEnv,
        ...publicFromWrangler,
        STAGING_FOUNDATION_SUPABASE_SECRET_KEY: "x",
        SENTRY_AUTH_TOKEN: "x",
        DATABASE_URL: "postgres://x",
        CF_API_TOKEN: "x",
        SUPABASE_ACCESS_TOKEN: "x",
        OZOW_REFUND_API_KEY: "x",
      },
      productionVars,
      createCloudflareStartupFixture
    );
    expect(problems).toEqual([]);
    const allowed = new Set([
      ...RUNNER_BASICS,
      ...Object.keys(productionVars),
      ...privateBuildNames(createCloudflareStartupFixture({}), productionVars),
    ]);
    for (const name of Object.keys(environment!)) expect(allowed.has(name), name).toBe(true);
    for (const name of [
      "STAGING_FOUNDATION_SUPABASE_SECRET_KEY",
      "SENTRY_AUTH_TOKEN",
      "DATABASE_URL",
      "CF_API_TOKEN",
      "SUPABASE_ACCESS_TOKEN",
      "OZOW_REFUND_API_KEY",
    ])
      expect(environment![name], name).toBeUndefined();
    expect(environment!.PATH).toBe("/usr/bin");
    for (const [name, value] of Object.entries(productionVars))
      expect(environment![name], name).toBe(value);
    expect(environment!.SUPABASE_SERVICE_ROLE_KEY).toMatch(/^sb_secret_[0-9a-f]{64}$/);
  });

  it("refuses public settings that differ from wrangler.toml or hold a server key", () => {
    const extra = releaseBuildEnvironment(
      { ...runnerEnv, ...publicFromWrangler, NEXT_PUBLIC_EXTRA: "x" },
      productionVars,
      createCloudflareStartupFixture
    );
    expect(extra.problems.join("\n")).toContain("differ from wrangler.toml: NEXT_PUBLIC_EXTRA");
    const serverKey = releaseBuildEnvironment(
      runnerEnv,
      { ...productionVars, FOUNDATION_SUPABASE_PUBLISHABLE_KEY: `sb_secret_${"0".repeat(32)}` },
      createCloudflareStartupFixture
    );
    expect(serverKey.problems.join("\n")).toContain(
      "Public settings hold a server key: FOUNDATION_SUPABASE_PUBLISHABLE_KEY"
    );
    expect(serverKey.environment).toBeUndefined();
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

describe("Wrangler build hook", () => {
  // No Worker output exists in a test checkout, so the hook must refuse
  // before rebuilding. PATH holds only Node: a hook that wrongly tried to
  // rebuild could not start pnpm, and would fail with a different message.
  // Windows cannot hold an empty environment variable, so "" is checked on Linux (CI) only.
  it.each(["verify-only", "VERIFY-ONLY", "yes", ...(process.platform === "win32" ? [] : [""])])(
    "only verifies when CLOUDFLARE_BUILD_HOOK is %j",
    (value) => {
      const result = spawnSync(process.execPath, ["scripts/ensure-opennext-build.mjs"], {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: path.dirname(process.execPath),
          SystemRoot: process.env.SystemRoot ?? "",
          CLOUDFLARE_BUILD_HOOK: value,
        },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("refusing to rebuild during a release step");
    }
  );
});
