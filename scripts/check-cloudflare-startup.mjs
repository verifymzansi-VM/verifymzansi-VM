import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { createTestHarness } from "wrangler";
import { createCloudflareStartupFixture } from "./lib/cloudflare-startup-fixture.mjs";

// Exercise the actual OpenNext artifact in workerd. A successful `next start`
// does not prove that the adapter inlined every manifest Next loads at startup.
if (process.argv.length > 2) throw new Error("Cloudflare startup check accepts no arguments");
const root = process.cwd();
const config = parse(await readFile(path.join(root, "wrangler.toml"), "utf8"));
await access(path.join(root, ".open-next/server-functions/default/handler.mjs"));
const sandbox = await mkdtemp(path.join(tmpdir(), "vm-worker-startup-"));
// Only synthetic runtime values. Use a separate root so Wrangler cannot load
// operator .env/.dev.vars files, and omit routes, triggers and remote bindings.
const vars = createCloudflareStartupFixture(config.vars);
const server = createTestHarness({
  root: sandbox,
  workers: [
    {
      config: {
        name: "vm-worker-startup",
        main: path.resolve(root, config.main),
        compatibility_date: config.compatibility_date,
        compatibility_flags: config.compatibility_flags,
        assets: { ...config.assets, directory: path.resolve(root, config.assets.directory) },
        durable_objects: config.durable_objects,
        migrations: config.migrations,
        kv_namespaces: config.kv_namespaces,
        vars,
      },
    },
  ],
});
try {
  await server.listen();
  const health = await server.fetch("https://runtime-check.invalid/api/health");
  assert.equal(health.status, 200, "Built Worker must start and serve its dynamic health route");
  const payload = await health.json();
  assert.equal(payload.status, "ok");
  assert.equal(payload.readiness, "ok");
  // Never authorize execution: no queued jobs, external messages or DB writes.
  const jobs = await server.fetch("https://runtime-check.invalid/api/webhooks/ops-jobs", {
    method: "POST",
  });
  assert.equal(jobs.status, 401, "Built Worker must reject unauthenticated job execution");
  assert.equal((await jobs.json()).error, "Unauthorized");
  const probeUrl = "https://runtime-check.invalid/api/internal/bindings/verify";
  const expected = Object.fromEntries(
    [
      "HMAC_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "FOUNDATION_SUPABASE_SECRET_KEY",
      "INTERNAL_JOBS_SECRET",
      "FOUNDATION_PHONE_OTP_KEY",
    ].map((name) => [name, createHash("sha256").update(vars[name]).digest("hex")])
  );
  const probe = (authorized, values = expected) =>
    server.fetch(probeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorized ? { Authorization: `Bearer ${vars.HEALTH_DIAGNOSTIC_TOKEN}` } : {}),
      },
      body: JSON.stringify({ expected: values }),
    });
  assert.equal(
    (await probe(false)).status,
    401,
    "Runtime proof must reject unauthenticated probes"
  );
  const correct = await probe(true);
  assert.equal(
    correct.status,
    200,
    "Built public settings and actual synthetic private Worker bindings must agree"
  );
  const bindingProof = await correct.json();
  assert.equal(bindingProof.ok, true);
  for (const value of Object.values(expected))
    assert.equal(JSON.stringify(bindingProof).includes(value), false);
  const changed = await probe(true, { ...expected, HMAC_SECRET: "0".repeat(64) });
  assert.equal(changed.status, 503, "A wrong runtime key must fail the proof");
  assert.equal((await changed.json()).checks.HMAC_SECRET.matches, false);
  const login = await server.fetch("https://runtime-check.invalid/login");
  assert.equal(login.status, 200, "Built Worker must render the login page through middleware");
  assert.match(login.headers.get("content-type") ?? "", /text\/html/);
  assert.match(login.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.match(await login.text(), /<html/);
  const fingerprint = JSON.parse(
    await readFile(path.join(root, ".open-next/build-fingerprint.json"), "utf8")
  );
  const hash = async (file) =>
    createHash("sha256")
      .update(await readFile(path.join(root, file)))
      .digest("hex");
  await mkdir(path.join(root, "tmp/cloudflare-runtime"), { recursive: true });
  await writeFile(
    path.join(root, "tmp/cloudflare-runtime/latest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        status: "PASS",
        checkedAt: new Date().toISOString(),
        sourceRevision: process.env.GITHUB_SHA ?? null,
        fingerprint,
        hashes: {
          entry: await hash("workers/open-next-entry.mjs"),
          handler: await hash(".open-next/server-functions/default/handler.mjs"),
          verifier: await hash("scripts/check-cloudflare-startup.mjs"),
        },
        controls: {
          workerdStartup: true,
          anonymousJobsDenied: true,
          loginHtmlAndCsp: true,
          anonymousBindingProbeDenied: true,
          compiledPublicConfiguration: true,
          syntheticPrivateBindings: true,
          mismatchedBindingDenied: true,
        },
        scope:
          "Actual built OpenNext artifact in isolated workerd; public build settings and synthetic runtime secrets only. No provider delivery or production mutation.",
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    "Cloudflare startup PASS: health200, unauthorized jobs401, login HTML/CSP, compiled public configuration and private runtime binding match/mismatch proofs in workerd."
  );
} catch (error) {
  // Only synthetic runtime credentials are installed above. Preserve the
  // workerd exception that caused a 500, rather than reporting just its status.
  server.debug();
  throw error;
} finally {
  await server.close();
  assert.equal(path.dirname(path.resolve(sandbox)), path.resolve(tmpdir()));
  await rm(sandbox, { recursive: true, force: true });
}
