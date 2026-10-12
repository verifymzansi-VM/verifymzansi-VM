// @vitest-environment node
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

import { checkStagingIsolation } from "../../scripts/check-staging-isolation.mjs";

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
    OTP_RATE_LIMITER_URL: "https://verifymzansi-rate-limiter.example.workers.dev",
  },
};

const isolatedStaging = {
  name: "verifymzansi-staging",
  routes: [],
  kv_namespaces: [{ binding: "OTP_RATE_LIMITS", id: "staging-kv" }],
  vars: {
    NODE_ENV: "production",
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
  it("rejects the checked-in staging block while it shares production resources", () => {
    const failures = checkStagingIsolation(parse(readFileSync("wrangler.toml", "utf8")));
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
    ["missing Supabase", { NEXT_PUBLIC_SUPABASE_URL: undefined }, /missing or unrecognised/],
  ])("rejects a single shared or weakened %s", (_label, override, message) => {
    const failures = checkStagingIsolation(
      withStaging({ ...isolatedStaging, vars: { ...isolatedStaging.vars, ...override } })
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(message);
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
