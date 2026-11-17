// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

import {
  COMPANION_CONFIGS,
  checkCompanionIsolation,
  checkResolvedConfigFile,
  checkResolvedStaging,
  checkStagingIsolation,
} from "../../scripts/check-staging-isolation.mjs";

const jwt = (ref: string) =>
  `e30.${Buffer.from(JSON.stringify({ ref, role: "anon" })).toString("base64url")}.sig`;

const production = {
  name: "verifymzansi",
  routes: [{ pattern: "verifymzansi.com", custom_domain: true }],
  kv_namespaces: [{ binding: "OTP_RATE_LIMITS", id: "prod-kv" }],
  vars: {
    NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
    NEXT_PUBLIC_MEDIA_URL: "https://media.verifymzansi.com",
    R2_PUBLIC_URL: "https://media.verifymzansi.com",
    R2_PUBLIC_BUCKET: "verifymzansi-public",
    R2_PRIVATE_BUCKET: "verifymzansi-private",
    NEXT_PUBLIC_SUPABASE_URL: "https://prodref.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("prodref"),
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_productionKey123",
    OTP_RATE_LIMITER_URL: "https://verifymzansi-rate-limiter.example.workers.dev",
  },
};

const isolatedStaging = {
  name: "verifymzansi-staging",
  routes: [],
  kv_namespaces: [{ binding: "OTP_RATE_LIMITS", id: "staging-kv" }],
  vars: {
    NODE_ENV: "production",
    ENVIRONMENT: "staging",
    NEXT_PUBLIC_APP_URL: "https://staging.verifymzansi.com",
    NEXT_PUBLIC_MEDIA_URL: "https://media-staging.verifymzansi.com",
    R2_PUBLIC_URL: "https://media-staging.verifymzansi.com",
    R2_PUBLIC_BUCKET: "verifymzansi-staging-public",
    R2_PRIVATE_BUCKET: "verifymzansi-staging-private",
    NEXT_PUBLIC_SUPABASE_URL: "https://stagingref.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("stagingref"),
    OTP_RATE_LIMITER_URL: "https://verifymzansi-rate-limiter-staging.example.workers.dev",
  },
};

const withStaging = (staging: object) => ({ ...production, env: { staging } });

describe("staging isolation preflight", () => {
  it("keeps the checked-in staging copy (M0.15b) separate from production", () => {
    const config = parse(readFileSync("wrangler.toml", "utf8")) as {
      env?: Record<string, { vars?: Record<string, string> }>;
    };
    expect(Object.keys(config.env ?? {}).sort()).toEqual(["production", "staging"]);
    expect(checkStagingIsolation(config, { requireStaging: true })).toEqual([]);
    const vars = config.env!.staging.vars!;
    expect(vars.ENVIRONMENT).toBe("staging");
    expect(vars.FOUNDATION_PROJECT_REF).toBe("vgplszqfcmdskwseoyam");
    // Cloudflare's published always-pass test site key, never the live one.
    expect(vars.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe("1x00000000000000000000AA");
    expect(vars.FOUNDATION_PHONE_VERIFICATION_ENABLED).toBe("false");
    for (const file of COMPANION_CONFIGS)
      expect(
        checkCompanionIsolation(parse(readFileSync(file, "utf8")), file, { requireStaging: true }),
        file
      ).toEqual([]);
  });

  it("runs in CI on every change", () => {
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain(
      "pnpm cloudflare:staging:isolation -- --require-staging"
    );
  });

  it("requires a staging section only when asked", () => {
    expect(checkStagingIsolation(production)).toEqual([]);
    expect(checkStagingIsolation(production, { requireStaging: true })).toEqual([
      "No [env.staging] section exists",
    ]);
  });

  it("rejects the former staging block that shared production resources", () => {
    const failures = checkStagingIsolation(
      withStaging({
        name: "verifymzansi-staging",
        kv_namespaces: [{ binding: "OTP_RATE_LIMITS", id: "prod-kv" }],
        vars: {
          ...production.vars,
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "https://staging.verifymzansi.com",
          VERIFYMZANSI_RUNTIME_MODE: "development",
        },
      })
    );
    expect(failures.join("\n")).toMatch(/production Supabase project/);
    expect(failures.join("\n")).toMatch(/production bucket "verifymzansi-private"/);
    expect(failures.join("\n")).toMatch(/KV namespace .* shared with production/);
    expect(failures.join("\n")).toMatch(/VERIFYMZANSI_RUNTIME_MODE="development"/);
  });

  it("accepts a staging block with separate project, buckets, KV, hosts and secure modes", () => {
    expect(checkStagingIsolation(withStaging(isolatedStaging))).toEqual([]);
  });

  it.each([
    [
      "Supabase URL",
      { NEXT_PUBLIC_SUPABASE_URL: "https://prodref.supabase.co" },
      /Supabase project/,
    ],
    ["anon key", { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("prodref") }, /ANON_KEY uses the production/],
    ["private bucket", { R2_PRIVATE_BUCKET: "verifymzansi-private" }, /production bucket/],
    [
      "rate limiter",
      { OTP_RATE_LIMITER_URL: production.vars.OTP_RATE_LIMITER_URL },
      /production host/,
    ],
    ["validation mode", { VERIFYMZANSI_VALIDATION_MODE: "development" }, /relaxes production/],
    ["e2e runtime mode", { VERIFYMZANSI_RUNTIME_MODE: "e2e" }, /relaxes production/],
    ["test shortcut", { PLAYWRIGHT_TEST_MODE: "1" }, /test shortcut/],
    ["environment name", { ENVIRONMENT: "production" }, /ENVIRONMENT must be "staging"/],
    [
      "production publishable key",
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_productionKey123" },
      /ANON_KEY uses the production/,
    ],
    ["missing Supabase", { NEXT_PUBLIC_SUPABASE_URL: undefined }, /missing or unrecognised/],
  ])("rejects a single shared or weakened %s", (_label, override, message) => {
    const failures = checkStagingIsolation(
      withStaging({ ...isolatedStaging, vars: { ...isolatedStaging.vars, ...override } })
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(message);
  });

  it("accepts a publishable key and matching foundation bindings for the staging project", () => {
    const vars = {
      ...isolatedStaging.vars,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_stagingKey12345",
      FOUNDATION_SUPABASE_URL: "https://stagingref.supabase.co",
      FOUNDATION_PROJECT_REF: "stagingref",
      FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_stagingKey12345",
    };
    expect(checkStagingIsolation(withStaging({ ...isolatedStaging, vars }))).toEqual([]);
    const mixed = checkStagingIsolation(
      withStaging({
        ...isolatedStaging,
        vars: { ...vars, FOUNDATION_SUPABASE_URL: "https://prodref.supabase.co" },
      })
    );
    expect(mixed.join("\n")).toMatch(/FOUNDATION_SUPABASE_URL and FOUNDATION_PROJECT_REF/);
  });

  it("rejects production companion Workers and the shared Images allowance", () => {
    const failures = checkStagingIsolation(
      withStaging({
        ...isolatedStaging,
        images: { binding: "IMAGES" },
        services: [{ binding: "OFFLOAD", service: "verifymzansi-offload" }],
      })
    );
    expect(failures.join("\n")).toMatch(/Images allowance/);
    expect(failures.join("\n")).toMatch(/Service binding "verifymzansi-offload"/);
  });

  it("checks a companion Worker's own name and rate-limit state", () => {
    const limiter = {
      name: "verifymzansi-rate-limiter",
      kv_namespaces: [{ binding: "OTP_RATE_LIMITS", id: "prod-kv" }],
    };
    expect(
      checkCompanionIsolation(
        {
          ...limiter,
          env: {
            staging: {
              name: "verifymzansi-rate-limiter-staging",
              vars: { ENVIRONMENT: "staging" },
              kv_namespaces: [{ binding: "OTP_RATE_LIMITS", id: "staging-kv" }],
            },
          },
        },
        "limiter"
      )
    ).toEqual([]);
    const shared = checkCompanionIsolation(
      {
        ...limiter,
        env: {
          staging: { name: "verifymzansi-rate-limiter", kv_namespaces: limiter.kv_namespaces },
        },
      },
      "limiter"
    );
    expect(shared.join("\n")).toMatch(/not staging-specific/);
    expect(shared.join("\n")).toMatch(/shared with production/);
    expect(shared.join("\n")).toMatch(/ENVIRONMENT must be "staging"/);
    expect(checkCompanionIsolation(limiter, "limiter", { requireStaging: true })).toEqual([
      "limiter: no [env.staging] section exists",
    ]);
  });

  it("rejects a shared KV namespace, production route and production Worker name", () => {
    const failures = checkStagingIsolation(
      withStaging({
        ...isolatedStaging,
        name: "verifymzansi",
        routes: [{ pattern: "verifymzansi.com" }],
        kv_namespaces: [{ binding: "OTP_RATE_LIMITS", id: "prod-kv" }],
      })
    );
    expect(failures).toHaveLength(3);
  });
});

// Wrangler inherits some top-level keys (routes among them) into an
// environment; these checks read the configs the way wrangler deploys them.
describe("staging as wrangler resolves it", () => {
  it("resolves the real staging configs with no route, domain, cron or shared binding", async () => {
    expect(await checkResolvedConfigFile("wrangler.toml")).toEqual([]);
    for (const file of COMPANION_CONFIGS)
      expect(await checkResolvedConfigFile(file), file).toEqual([]);
  }, 60_000);

  it("fails the real wrangler.toml when staging's `routes = []` is removed", async () => {
    const real = readFileSync("wrangler.toml", "utf8");
    const withoutRoutes = real.replace(/^routes = \[\]\r?\n/m, "");
    // Exactly the one staging line is gone; production's routes stay.
    expect(withoutRoutes).not.toBe(real);
    expect(withoutRoutes).not.toMatch(/^routes = \[\]/m);
    const dir = mkdtempSync(path.join(tmpdir(), "vm-staging-routes-"));
    try {
      const file = path.join(dir, "wrangler.toml");
      writeFileSync(file, withoutRoutes);
      // The raw TOML alone does not show the problem...
      expect(
        checkStagingIsolation(parse(withoutRoutes) as object, { requireStaging: true })
      ).toEqual([]);
      // ...the resolved config does: production's custom domains would move.
      const failures = (await checkResolvedConfigFile(file, "copy")).join("\n");
      expect(failures).toMatch(/resolves custom domain verifymzansi\.com/);
      expect(failures).toMatch(/resolves custom domain www\.verifymzansi\.com/);
      expect(failures).toMatch(/wrangler warns: .*inherits the top-level `routes`/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("flags inherited triggers, shared bindings and production Durable Objects", () => {
    const production = [
      {
        name: "verifymzansi",
        kv_namespaces: [{ binding: "KV", id: "prod-kv" }],
        r2_buckets: [{ binding: "B", bucket_name: "verifymzansi-public" }],
        queues: { producers: [{ binding: "Q", queue: "prod-queue" }] },
      },
    ];
    const staging = {
      name: "verifymzansi-staging",
      routes: [],
      triggers: { crons: ["* * * * *"] },
      kv_namespaces: [{ binding: "KV", id: "prod-kv" }],
      r2_buckets: [{ binding: "B", bucket_name: "verifymzansi-public" }],
      queues: { producers: [{ binding: "Q", queue: "prod-queue" }] },
      durable_objects: { bindings: [{ name: "DO", class_name: "X", script_name: "verifymzansi" }] },
      images: { binding: "IMAGES" },
    };
    const failures = checkResolvedStaging(
      {
        staging,
        production,
        warnings: [
          '▲ [WARNING] Processing wrangler.toml configuration: - "env.staging" environment configuration - "images" exists at the top level, but not on "env.staging". This is not what you probably want.',
          '▲ [WARNING] Processing wrangler.toml configuration: - "env.staging" environment configuration - The "env.staging" environment inherits the top-level `triggers` configuration.',
        ],
      },
      "x"
    ).join("\n");
    expect(failures).toMatch(/cron triggers/);
    expect(failures).toMatch(/kv_namespaces:prod-kv is shared/);
    expect(failures).toMatch(/r2_buckets:verifymzansi-public is shared/);
    expect(failures).toMatch(/queues:prod-queue is shared/);
    expect(failures).toMatch(/Durable Object DO lives in Worker "verifymzansi"/);
    expect(failures).toMatch(/Images binding/);
    expect(failures).toMatch(/inherits the top-level `triggers`/);
    // The reviewed Images notice alone is not a failure.
    expect(failures).not.toMatch(/"images" exists at the top level/);
  });

  it("requires ENVIRONMENT = staging on the staging Worker", () => {
    const { ENVIRONMENT: _omitted, ...vars } = isolatedStaging.vars;
    expect(checkStagingIsolation(withStaging({ ...isolatedStaging, vars }))).toEqual([
      'ENVIRONMENT must be "staging" in staging',
    ]);
  });
});
