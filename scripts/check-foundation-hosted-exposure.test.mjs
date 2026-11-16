// Offline tests for scripts/check-foundation-hosted-exposure.mjs, the
// post-deploy check that re-reads the live project's Data API exposure and
// Auth settings with the publishable key. Every network call is answered by a
// fake fetch preloaded into the child process; nothing leaves this machine.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const SCRIPT = "scripts/check-foundation-hosted-exposure.mjs";
const HOST = "https://gntzjtuncsyefujajmjy.supabase.co";
const KEY = "sb_publishable_synthetic";
const work = mkdtempSync(join(tmpdir(), "hosted-exposure-"));
after(() => rmSync(work, { recursive: true, force: true }));

// The fake answers like the hosted gateway (PostgREST 12+): for a POST it takes
// the schema from Content-Profile; an unexposed schema gets 406 PGRST106 with
// the list of exposed schemas in its hint; an exposed one answers the read.
// world.down: a path that answers 503 (world.downTimes times, or always).
const preload = join(work, "fake-fetch.mjs");
writeFileSync(
  preload,
  `import { appendFileSync } from "node:fs";
const world = JSON.parse(process.env.FAKE_WORLD);
const answered = {};
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ url: url.href, method: init.method ?? "GET", headers, redirect: init.redirect, hasSignal: Boolean(init.signal) }) + "\\n");
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  answered[url.pathname] = (answered[url.pathname] ?? 0) + 1;
  if (world.throws === url.pathname) throw new TypeError("fetch failed");
  if (world.down === url.pathname && answered[url.pathname] <= (world.downTimes ?? 99)) return json(503, {});
  if (url.pathname === "/rest/v1/rpc/get_current_posting_terms") {
    const schema = (init.method ?? "GET") === "POST" ? headers["content-profile"] : headers["accept-profile"];
    if (world.exposed.includes(schema)) return json(200, { version: "posting-v3" });
    return json(406, {
      code: "PGRST106",
      details: null,
      hint: world.noHint ? null : "Only the following schemas are exposed: " + world.exposed.join(", "),
      message: "Invalid schema: " + schema,
    });
  }
  if (url.pathname === "/graphql/v1")
    return world.graphql ? json(200, { data: { __typename: "Query" } }) : json(400, { errors: [{ message: "off" }] });
  if (url.pathname === "/auth/v1/settings")
    return world.authStatus ? json(world.authStatus, { msg: "x" }) : json(200, {
      mailer_autoconfirm: world.autoconfirm, external: { anonymous_users: world.anonymous, email: true },
    });
  return json(404, {});
};
`
);

const good = { exposed: ["api"], graphql: false, autoconfirm: false, anonymous: false };
let runs = 0;
function run(world, { stage = "cutover", env = {} } = {}) {
  const log = join(work, `calls-${++runs}.jsonl`);
  writeFileSync(log, "");
  const result = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(preload).href, SCRIPT, `--stage=${stage}`],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        FOUNDATION_SUPABASE_URL: HOST,
        FOUNDATION_SUPABASE_PUBLISHABLE_KEY: KEY,
        EXPOSURE_RETRY_DELAY_MS: "1",
        FAKE_WORLD: JSON.stringify(world),
        FAKE_LOG: log,
        ...env,
      },
    }
  );
  const calls = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { ...result, calls };
}

describe("hosted exposure check", () => {
  it("passes when only api is exposed, GraphQL is off and Auth needs confirmation", () => {
    const result = run(good);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS cutover: exposure matches the reviewed policy/);
    assert.match(result.stdout, /"exposedSchemas": \[\s*"api"\s*\]/);
    // Six schema probes (one a name that cannot exist), GraphQL and Auth.
    assert.equal(result.calls.length, 8);
  });

  it("sends only the publishable key, sets both profile headers, never follows redirects", () => {
    const { calls } = run(good);
    for (const call of calls) {
      assert.equal(new URL(call.url).origin, HOST);
      assert.equal(call.headers.apikey, KEY);
      assert.equal(call.headers.authorization, undefined, "no bearer token is sent");
      assert.equal(call.redirect, "error");
      assert.equal(call.hasSignal, true);
    }
    const probes = calls.filter((c) => c.url.endsWith("/rpc/get_current_posting_terms"));
    for (const probe of probes) {
      assert.equal(probe.method, "POST");
      assert.equal(probe.headers["content-profile"], probe.headers["accept-profile"]);
    }
    assert.deepEqual(
      probes.slice(0, 5).map((p) => p.headers["content-profile"]),
      ["api", "private", "internal", "public", "graphql_public"]
    );
    assert.match(probes[5].headers["content-profile"], /^vm_probe_[0-9a-f]{12}$/);
  });

  for (const [label, world, message] of [
    ["private is exposed", { ...good, exposed: ["api", "private"] }, /private must not be exposed/],
    [
      "internal is exposed",
      { ...good, exposed: ["api", "internal"] },
      /internal must not be exposed/,
    ],
    ["public is exposed", { ...good, exposed: ["api", "public"] }, /public must not be exposed/],
    [
      "graphql_public is exposed",
      { ...good, exposed: ["api", "graphql_public"] },
      /graphql_public must not be exposed/,
    ],
    ["storage is exposed too", { ...good, exposed: ["api", "storage"] }, /only api may be exposed/],
    ["api is not exposed", { ...good, exposed: [] }, /api exposure does not match the stage/],
    ["GraphQL answers", { ...good, graphql: true }, /GraphQL must stay off/],
    ["Auth confirms addresses itself", { ...good, autoconfirm: true }, /mailer_autoconfirm/],
    ["anonymous sign-ins are on", { ...good, anonymous: true }, /anonymous sign-ins/],
    [
      "Auth settings are unreadable",
      { ...good, authStatus: 401 },
      /Auth settings must be readable/,
    ],
    ["Auth settings omit the flag", { ...good, autoconfirm: undefined }, /mailer_autoconfirm/],
  ])
    it(`fails when ${label}`, () => {
      const result = run(world);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, message);
      assert.doesNotMatch(result.stdout, /PASS/);
    });

  it("retries a gateway outage and passes once it answers", () => {
    const result = run({ ...good, down: "/auth/v1/settings", downTimes: 2 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.filter((c) => c.url.endsWith("/auth/v1/settings")).length, 3);
  });

  for (const [label, world] of [
    ["a probe keeps answering 5xx", { ...good, down: "/rest/v1/rpc/get_current_posting_terms" }],
    ["the network fails", { ...good, throws: "/auth/v1/settings" }],
    ["the gateway does not list the exposed schemas", { ...good, noHint: true }],
  ])
    it(`reports inconclusive, never exposure, when ${label}`, () => {
      const result = run(world);
      assert.equal(result.status, 3, result.stderr);
      assert.match(result.stderr, /^INCONCLUSIVE: /m);
      assert.doesNotMatch(result.stderr, /must not be exposed|only api/);
      assert.doesNotMatch(result.stdout, /PASS/);
    });

  for (const [label, env] of [
    [
      "the URL is another project",
      { FOUNDATION_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" },
    ],
    [
      "the URL is not https",
      { FOUNDATION_SUPABASE_URL: "http://gntzjtuncsyefujajmjy.supabase.co" },
    ],
    ["the URL is missing", { FOUNDATION_SUPABASE_URL: "" }],
    ["the key is a secret key", { FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_secret_synthetic" }],
    ["the key is a legacy JWT", { FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "legacy-jwt-synthetic" }],
    ["the key is missing", { FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "" }],
  ])
    it(`refuses to call anything when ${label}`, () => {
      const result = run(good, { env });
      assert.notEqual(result.status, 0);
      assert.equal(result.calls.length, 0);
    });

  it("refuses to run without a known stage", () => {
    for (const stage of ["", "production"]) {
      const result = run(good, { stage });
      assert.notEqual(result.status, 0);
      assert.equal(result.calls.length, 0);
    }
  });

  it("before cutover requires api to stay hidden too", () => {
    assert.equal(run({ ...good, exposed: [] }, { stage: "pre-cutover" }).status, 0);
    assert.notEqual(run(good, { stage: "pre-cutover" }).status, 0);
  });
});

describe("deploy workflow runs the check after every deploy", () => {
  const steps = parse(readFileSync(".github/workflows/deploy.yml", "utf8")).jobs.deploy.steps;
  const index = steps.findIndex((s) => s.name === "Recheck live project security settings");
  const step = steps[index];

  it("has exactly one step that runs it for the cutover stage, unconditionally", () => {
    assert.ok(index > 0, "deploy.yml has the security settings step");
    assert.equal(
      steps.filter((s) => (s.run ?? "").includes("check-foundation-hosted-exposure")).length,
      1
    );
    assert.equal(step.run, "node scripts/check-foundation-hosted-exposure.mjs --stage=cutover");
    assert.equal(step.if, undefined, "it runs whenever the deploy got this far");
    assert.equal(step["continue-on-error"], undefined, "drift must fail the deploy run");
    assert.equal(typeof step["timeout-minutes"], "number");
  });

  it("gives the step only the project URL and the publishable key", () => {
    assert.deepEqual(step.env, {
      FOUNDATION_SUPABASE_URL: "${{ secrets.FOUNDATION_SUPABASE_URL }}",
      FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "${{ secrets.FOUNDATION_SUPABASE_PUBLISHABLE_KEY }}",
    });
  });

  it("runs right after the rollback stop and before the browser install", () => {
    assert.equal(steps[index - 1].name, "Stop for manual rollback");
    assert.equal(steps[index + 1].name, "Install Chromium for post-deploy verification");
    const deploy = steps.findIndex((s) => s.name === "Deploy to Cloudflare");
    const health = steps.findIndex((s) => s.name === "Post-deploy health check");
    assert.ok(deploy > 0 && health > deploy && index > health);
  });
});
