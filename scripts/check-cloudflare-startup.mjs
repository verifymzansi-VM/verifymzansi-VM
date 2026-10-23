import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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
const vars = createCloudflareStartupFixture();
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
  const login = await server.fetch("https://runtime-check.invalid/login");
  assert.equal(login.status, 200, "Built Worker must render the login page through middleware");
  assert.match(login.headers.get("content-type") ?? "", /text\/html/);
  assert.match(login.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.match(await login.text(), /<html/);
  console.log(
    "Cloudflare startup PASS: health200, unauthorized jobs401 and login HTML/CSP in workerd."
  );
} catch (error) {
  // Only synthetic runtime credentials are installed above. Preserve the
  // workerd exception that caused a 500, rather than reporting just its status.
  server.debug();
  throw error;
} finally {
  await server.close();
  await rm(sandbox, { recursive: true, force: true });
}
