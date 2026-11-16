/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  approvedHostedProjectRef,
  browserHostedProjectRef,
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
} from "./hosted-projects";
import { verifyFoundationDeploymentConnection } from "./deployment-connection";

it("approves the staging project only for ENVIRONMENT=staging", () => {
  expect(approvedHostedProjectRef("staging")).toBe(STAGING_PROJECT_REF);
  for (const environment of ["production", undefined, "", "Staging", "test"])
    expect(approvedHostedProjectRef(environment)).toBe(PRODUCTION_PROJECT_REF);
});

it("lets a browser bundle name only the two hosted projects", () => {
  expect(browserHostedProjectRef(`${STAGING_PROJECT_REF}.supabase.co`)).toBe(STAGING_PROJECT_REF);
  expect(browserHostedProjectRef(`${PRODUCTION_PROJECT_REF}.supabase.co`)).toBe(
    PRODUCTION_PROJECT_REF
  );
  // Any other host is checked against production and so refused by the URL guard.
  expect(browserHostedProjectRef("abcdefghijklmnopqrst.supabase.co")).toBe(PRODUCTION_PROJECT_REF);
});

it("refuses a deployment whose project does not match its environment", () => {
  const secret = "sb_secret_" + "s".repeat(24); // secret-scan: allow synthetic shape only
  const deployment = (environment: string, ref: string) => ({
    ENVIRONMENT: environment,
    FOUNDATION_SUPABASE_URL: `https://${ref}.supabase.co`,
    FOUNDATION_PROJECT_REF: ref,
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic",
    FOUNDATION_SUPABASE_SECRET_KEY: secret,
    SUPABASE_SERVICE_ROLE_KEY: secret,
  });
  expect(
    verifyFoundationDeploymentConnection(deployment("staging", STAGING_PROJECT_REF))
      .expectedProjectRef
  ).toBe(STAGING_PROJECT_REF);
  expect(
    verifyFoundationDeploymentConnection(deployment("production", PRODUCTION_PROJECT_REF))
      .expectedProjectRef
  ).toBe(PRODUCTION_PROJECT_REF);
  expect(() =>
    verifyFoundationDeploymentConnection(deployment("production", STAGING_PROJECT_REF))
  ).toThrow("approved");
  expect(() =>
    verifyFoundationDeploymentConnection(deployment("staging", PRODUCTION_PROJECT_REF))
  ).toThrow("approved");
});

it("keeps the build guard in next.config.js on the same two projects", () => {
  const config = readFileSync("next.config.js", "utf8").replace(/\r\n/g, "\n");
  const origins = [...config.matchAll(/"https:\/\/([a-z0-9]{20})\.supabase\.co"/g)].map(
    (m) => m[1]
  );
  expect(new Set(origins)).toEqual(new Set([STAGING_PROJECT_REF, PRODUCTION_PROJECT_REF]));
  // The staging origin is chosen only for ENVIRONMENT === "staging".
  expect(config).toContain(
    `process.env.ENVIRONMENT === "staging"\n      ? "https://${STAGING_PROJECT_REF}.supabase.co"\n      : "https://${PRODUCTION_PROJECT_REF}.supabase.co"`
  );
});
