import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestHarness } from "wrangler";
import { parse } from "smol-toml";

assert.equal(process.argv.length, 2);
const sandbox = await mkdtemp(path.join(tmpdir(), "vm-companion-runtime-"));
const jobKey = "synthetic-companion-jobs-only-".repeat(2);
const opsKey = "synthetic-companion-operations-only-".repeat(2);
const cases = [
  ["payment-cleanup", "/api/internal/payments/reconcile"],
  ["retention-cleanup", "/api/internal/retention/run"],
  ["ops-jobs", "/api/webhooks/ops-jobs"],
];
const companions = await Promise.all(
  cases.map(async ([name]) => {
    const config = parse(await readFile(`wrangler.${name}.toml`, "utf8"));
    assert.equal(config.main, `workers/${name}.ts`);
    return {
      config: {
        name: "vm-companion-" + name,
        main: path.resolve(config.main),
        compatibility_date: config.compatibility_date,
        compatibility_flags: config.compatibility_flags,
        services: [{ binding: "APP", service: "vm-companion-app" }],
        vars: {
          APP_URL: config.vars.APP_URL,
          ...(config.vars.DATA_BACKEND ? { DATA_BACKEND: config.vars.DATA_BACKEND } : {}),
          WORKER_API_KEY: jobKey,
          OPS_JOBS_SECRET: opsKey,
        },
      },
    };
  })
);
// Isolated root and explicit synthetic vars: no workstation env files, real
// storage, provider credentials, public app handlers or production mutation.
const server = createTestHarness({
  root: sandbox,
  workers: [
    ...companions,
    {
      config: {
        name: "vm-companion-app",
        main: path.resolve("scripts/fixtures/companion-app-worker.ts"),
        compatibility_date: "2026-01-01",
        vars: { JOB_KEY: jobKey, OPS_KEY: opsKey },
      },
    },
  ],
});
try {
  await server.listen();
  for (const [name] of cases.slice(0, 2)) {
    const response = await server
      .getWorker("vm-companion-" + name)
      .fetch("https://fixture.invalid/", { method: "POST" });
    assert.equal(response.status, 401);
  }
  const app = server.getWorker("vm-companion-app");
  assert.deepEqual(
    (await (await app.fetch("https://fixture.invalid/snapshot")).json()).received,
    []
  );
  for (const [name] of cases)
    await server
      .getWorker("vm-companion-" + name)
      .scheduled({ cron: "test", scheduledTime: new Date() });
  const snapshot = await (await app.fetch("https://fixture.invalid/snapshot")).json();
  assert.deepEqual(snapshot.received.sort(), cases.map(([, endpoint]) => endpoint).sort());
  console.log(
    "Companion workerd PASS: all three scheduled jobs use service bindings and scoped keys; unauthorized manual triggers execute nothing."
  );
} catch (error) {
  server.debug();
  throw error;
} finally {
  await server.close();
  assert.equal(path.dirname(path.resolve(sandbox)), path.resolve(tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("vm-companion-runtime-"));
  await rm(sandbox, { recursive: true });
}
