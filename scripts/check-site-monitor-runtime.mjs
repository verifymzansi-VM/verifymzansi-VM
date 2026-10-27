import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestHarness } from "wrangler";
const root = await mkdtemp(path.join(tmpdir(), "vm-site-monitor-"));
const key = "synthetic-private-monitor-only-".repeat(2);
const config = (degraded) => ({
  root,
  workers: [
    {
      config: {
        name: "vm-monitor",
        main: path.resolve("workers/site-monitor.ts"),
        compatibility_date: "2026-10-13",
        services: [{ binding: "APP", service: "vm-monitor-app" }],
        vars: { APP_URL: "https://verifymzansi.com", MONITOR_API_KEY: key },
      },
    },
    {
      config: {
        name: "vm-monitor-app",
        main: path.resolve("scripts/fixtures/site-monitor-app.ts"),
        compatibility_date: "2026-10-13",
        vars: degraded ? { DEGRADED: "true" } : {},
      },
    },
  ],
});
const server = createTestHarness(config(false));
try {
  await server.listen();
  assert.equal((await server.fetch("https://fixture.invalid/")).status, 401);
  const response = await server.fetch("https://fixture.invalid/", {
    headers: { Authorization: `Bearer ${key}`, Cookie: "private-session=must-not-forward" },
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes("PRIVATE_UPSTREAM_BODY"), false);
  assert.equal(JSON.parse(text).checks.length, 12);
  await server.update(config(true));
  assert.equal(
    (
      await server.fetch("https://fixture.invalid/", {
        headers: { Authorization: `Bearer ${key}` },
      })
    ).status,
    503
  );
  console.log(
    "Site monitor workerd PASS: authenticated fixed anonymous smoke checks, no caller-credential forwarding or private bodies, degraded dependencies fail closed."
  );
} finally {
  await server.close();
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith("vm-site-monitor-"));
  await rm(root, { recursive: true });
}
