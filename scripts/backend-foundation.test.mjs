import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkIsolation,
  RESOURCE_KEYS,
  summarizeRegionSamples,
  quantile,
} from "./lib/backend-foundation.mjs";

function fixture() {
  const env = (prefix) => ({
    ...Object.fromEntries(RESOURCE_KEYS.map((key) => [key, `${prefix}-${key.toLowerCase()}`])),
    supabaseProject: prefix === "prod" ? "aaaaaaaaaaaaaaaaaaaa" : "bbbbbbbbbbbbbbbbbbbb",
    authProject: prefix === "prod" ? "aaaaaaaaaaaaaaaaaaaa" : "bbbbbbbbbbbbbbbbbbbb",
    ...Object.fromEntries(
      RESOURCE_KEYS.filter((key) => key.endsWith("Storage")).map((key) => [
        key,
        `r2:${prefix}-${key.toLowerCase()}`,
      ])
    ),
    limiter: `kv:${prefix}-limiter`,
    queue: `queue:${prefix}-queue`,
    cache: `r2:${prefix}-cache`,
    credentialSet: `secret-set:${prefix}-credentials`,
    fixtureData: "synthetic-only",
    providers: { mail: "stub", sms: "stub", payments: "stub", scanner: "stub" },
  });
  return { schemaVersion: 1, environments: { production: env("prod"), staging: env("stage") } };
}
test("complete isolated fixture identity passes only its declaration scope", () => {
  assert.equal(checkIsolation(fixture(), "staging").status, "PASS");
});
test("every missing or shared identity denies fixtures", () => {
  for (const key of RESOURCE_KEYS) {
    const missing = fixture();
    delete missing.environments.staging[key];
    assert.equal(checkIsolation(missing, "staging").status, "FAIL", key);
    const shared = fixture();
    shared.environments.staging[key] = shared.environments.production[key];
    assert.equal(checkIsolation(shared, "staging").status, "FAIL", key);
  }
});
test("absent or incomplete production baseline cannot pass isolation", () => {
  for (const baseline of [undefined, null, {}, [], "prod"]) {
    const manifest = fixture();
    manifest.environments.production = baseline;
    assert.equal(checkIsolation(manifest, "staging").status, "FAIL");
  }
  for (const key of RESOURCE_KEYS) {
    const manifest = fixture();
    delete manifest.environments.production[key];
    assert.equal(checkIsolation(manifest, "staging").status, "FAIL", key);
  }
});
test("cross-purpose resource reuse and cross-environment reuse both fail", () => {
  const manifest = fixture();
  manifest.environments.staging.privateStorage = manifest.environments.production.temporaryStorage;
  assert.equal(checkIsolation(manifest, "staging").status, "FAIL");
  const same = fixture();
  same.environments.staging.privateStorage = same.environments.staging.publicStorage;
  assert.equal(checkIsolation(same, "staging").status, "FAIL");
});
test("unknown environments, source and production never become fixture targets", () => {
  for (const name of ["production", "source", "", "__proto__"])
    assert.equal(checkIsolation(fixture(), name).status, "FAIL");
  assert.equal(checkIsolation(fixture(), "target").status, "INCOMPLETE");
});
test("live provider settings, malformed identities and absent synthetic declaration fail", () => {
  const manifest = fixture();
  manifest.environments.staging.providers.payments = "production";
  manifest.environments.staging.fixtureData = null;
  manifest.environments.staging.hostname = "https://user:password@example.test";
  assert.equal(checkIsolation(manifest, "staging").status, "FAIL");
});
test("noncanonical protected hostnames and URL aliases cannot evade comparisons", () => {
  const manifest = fixture();
  manifest.environments.production.hostname = "STAGE-HOSTNAME";
  assert.equal(checkIsolation(manifest, "staging").status, "FAIL");
  const alias = fixture();
  alias.environments.staging.hostname = "https://stage-hostname/";
  assert.equal(checkIsolation(alias, "staging").status, "FAIL");
  for (const hostname of [
    "stage-hostname.",
    ".stage-hostname",
    "stage..hostname",
    "-stage.hostname",
  ]) {
    const candidate = fixture();
    candidate.environments.staging.hostname = hostname;
    assert.equal(checkIsolation(candidate, "staging").status, "FAIL");
  }
  const unknown = fixture();
  unknown.environments.sb_secret_synthetic = {};
  const result = checkIsolation(unknown, "staging");
  assert.equal(result.status, "FAIL");
  assert.equal(JSON.stringify(result).includes("sb_secret"), false);
});
const sample = (overrides = {}) => ({
  region: "eu-west-1",
  city: "Johannesburg",
  connection: "fixed",
  window: "morning",
  carrier: "synthetic-carrier",
  probeId: "synthetic-probe",
  edgeColo: "JNB",
  path: "browse",
  transport: "worker",
  placement: "default",
  cacheState: "warm",
  datasetHash: "synthetic-v1",
  compute: "micro",
  payloadClass: "browse-24",
  ok: true,
  totalMs: 100,
  ttfbMs: 80,
  queryCount: 1,
  dbMs: 10,
  ...overrides,
});
test("nearest rank quantiles and failures remain visible; all failed timings are null", () => {
  assert.equal(quantile([3, 1, 2], 0.95), 3);
  const [group] = summarizeRegionSamples([sample(), sample({ ok: false, totalMs: 5000 })]);
  assert.equal(group.failureRate, 0.5);
  assert.equal(group.totalMs.p95, 100);
  assert.equal(group.minimumSamplesMet, false);
  assert.equal(summarizeRegionSamples([sample({ ok: false })])[0].totalMs.p50, null);
});
test("regions, windows, placements and fixture configurations are never pooled", () => {
  const rows = [
    sample(),
    sample({ region: "eu-west-2" }),
    sample({ window: "evening" }),
    sample({ placement: "aws:eu-west-1" }),
    sample({ datasetHash: "synthetic-v2" }),
    sample({ compute: "small" }),
  ];
  assert.equal(summarizeRegionSamples(rows).length, rows.length);
});
test("sample counts distinguish warm/cold and reject invalid measurements", () => {
  assert.equal(
    summarizeRegionSamples(Array.from({ length: 100 }, () => sample()))[0].minimumSamplesMet,
    true
  );
  assert.equal(
    summarizeRegionSamples(Array.from({ length: 20 }, () => sample({ cacheState: "cold" })))[0]
      .minimumSamplesMet,
    true
  );
  for (const overrides of [
    { totalMs: NaN },
    { ttfbMs: 101 },
    { dbMs: -1 },
    { queryCount: 1.5 },
    { ok: "true" },
    { cacheState: "unknown" },
  ]) {
    assert.throws(() => summarizeRegionSamples([sample(overrides)]));
  }
});
test("carrier/colo paths stay separate, query drift is visible, and API-key labels are refused", () => {
  assert.equal(
    summarizeRegionSamples([
      sample(),
      sample({ carrier: "other-carrier" }),
      sample({ edgeColo: "CPT" }),
    ]).length,
    3
  );
  assert.equal(
    summarizeRegionSamples([sample(), sample({ queryCount: 2 })])[0].queryCountConsistent,
    false
  );
  for (const value of [
    "sb_secret_synthetic",
    "sb_publishable_synthetic",
    "github_pat_synthetic",
    "eyJsynthetic.jwt",
    "sk_synthetic",
  ]) {
    assert.throws(() => summarizeRegionSamples([sample({ datasetHash: value })]));
  }
});
test("failed connection attempts retain null TTFB and total rather than invent timings", () => {
  const [group] = summarizeRegionSamples([
    sample(),
    sample({ ok: false, totalMs: null, ttfbMs: null, dbMs: null }),
  ]);
  assert.equal(group.attempted, 2);
  assert.equal(group.failureRate, 0.5);
  assert.equal(group.measuredTotalCount, 1);
  assert.equal(group.measuredTtfbCount, 1);
  assert.throws(() => summarizeRegionSamples([sample({ totalMs: null })]));
  assert.throws(() => summarizeRegionSamples([sample({ ttfbMs: null })]));
});
