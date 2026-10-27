import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  verifyFoundationDeploymentConnection,
  verifyFoundationReleaseArtifact,
  FoundationReleasePending,
  verifyFoundationArtifactIntegrity,
} from "./lib/foundation-deployment";

const env = {
  NEXT_PUBLIC_DATA_BACKEND: "foundation",
  FOUNDATION_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
  FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy",
  FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_deployment",
  FOUNDATION_SUPABASE_SECRET_KEY: "sb_secret_synthetic_deployment_key",
  NEXT_PUBLIC_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic_deployment",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic_deployment_key",
};
test("deployment uses one approved London connection for browser and server", () => {
  assert.equal(
    verifyFoundationDeploymentConnection(env).expectedProjectRef,
    "gntzjtuncsyefujajmjy"
  );
});
for (const [label, change] of [
  ["fixture mode", { NEXT_PUBLIC_DATA_BACKEND: "source" }],
  ["retired browser URL", { NEXT_PUBLIC_SUPABASE_URL: "https://tnygdgormnofpgjknlhr.supabase.co" }],
  [
    "another server project",
    {
      FOUNDATION_PROJECT_REF: "abcdefghijklmnopqrst",
      FOUNDATION_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    },
  ],
  [
    "secret in public slot",
    { FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_secret_synthetic_deployment_key" },
  ],
  ["different browser key", { NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_another_synthetic" }],
  ["different server alias", { SUPABASE_SERVICE_ROLE_KEY: "sb_secret_different_synthetic_key" }],
] as const)
  test(`refuses ${label} before network activity`, () =>
    assert.throws(() => verifyFoundationDeploymentConnection({ ...env, ...change })));
test("configuration errors never include supplied credential values", () => {
  const value = "sb_secret_private_marker_not_a_real_key";
  try {
    verifyFoundationDeploymentConnection({ ...env, FOUNDATION_SUPABASE_PUBLISHABLE_KEY: value });
    assert.fail("Expected rejection");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(value), false);
  }
});
test("an intact but unreleased foundation assembly remains blocked", () => {
  const candidate = "synthetic candidate";
  const manifest = {
    schemaVersion: 1,
    candidateHash: createHash("sha256").update(candidate).digest("base64url"),
    releaseReady: false,
  };
  assert.throws(
    () => verifyFoundationReleaseArtifact(manifest, candidate),
    FoundationReleasePending
  );
  assert.doesNotThrow(() =>
    verifyFoundationReleaseArtifact({ ...manifest, releaseReady: true }, candidate)
  );
  assert.throws(() =>
    verifyFoundationReleaseArtifact({ ...manifest, releaseReady: true }, candidate + "modified")
  );
});

test("provisioned app updates validate the SQL digest without declaring a database release", () => {
  const candidate = "synthetic provisioned runtime";
  const manifest = {
    schemaVersion: 1,
    candidateHash: createHash("sha256").update(candidate).digest("base64url"),
    releaseReady: false,
  };
  assert.doesNotThrow(() => verifyFoundationArtifactIntegrity(manifest, candidate));
  assert.throws(() => verifyFoundationArtifactIntegrity(manifest, candidate + "stale"));
  assert.throws(() =>
    verifyFoundationArtifactIntegrity({ ...manifest, schemaVersion: 2 }, candidate)
  );
  assert.throws(
    () => verifyFoundationReleaseArtifact(manifest, candidate),
    FoundationReleasePending
  );
  assert.equal(manifest.releaseReady, false);
});
test("deployment and runtime configuration never select the deleted database", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(pkg.scripts.deploy.startsWith("pnpm preflight:foundation --provisioned-runtime &&"));
  const config = readFileSync("wrangler.toml", "utf8");
  assert.equal(config.includes("tnygdgormnofpgjknlhr"), false);
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
  assert.ok(workflow.includes("NEXT_PUBLIC_DATA_BACKEND: foundation"));
  assert.ok(workflow.includes("secrets.FOUNDATION_SUPABASE_SECRET_KEY"));
  assert.ok(workflow.includes("pnpm run preflight:foundation"));
  assert.ok(workflow.includes("preflight:foundation -- --provisioned-runtime"));
  assert.ok(workflow.includes("pnpm run backend:verify:live"));
  assert.equal(workflow.includes("run: pnpm run db:verify-schema"), false);
  assert.equal(workflow.includes("run: pnpm run preflight:prod"), false);
});

test("the actual preflight CLI loads and stops at the current unreleased assembly", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/preflight-foundation.ts"],
    {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    }
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /INCOMPLETE: foundation acceptance is still open/);
});
