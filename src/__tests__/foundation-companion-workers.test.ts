/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import payment from "../../workers/payment-cleanup";
import retention from "../../workers/retention-cleanup";
import operations from "../../workers/ops-jobs";
const key = "synthetic-companion-job-credential-".repeat(2);
const env = {
  DATA_BACKEND: "foundation" as const,
  APP_URL: "https://verifymzansi.com",
  WORKER_API_KEY: key,
  APP: { fetch: vi.fn(), connect: vi.fn() },
};
const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => env.APP.fetch.mockReset());
for (const [worker, path] of [
  [payment, "/api/internal/payments/reconcile"],
  [retention, "/api/internal/retention/run"],
] as const) {
  it(`${path}: delegates once without any database or storage binding`, async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    env.APP.fetch.mockResolvedValue(new Response("{}"));
    await worker.scheduled!({ cron: "test", scheduledTime: 0 }, env, context);
    expect(fetcher).not.toHaveBeenCalled();
    expect(env.APP.fetch).toHaveBeenCalledExactlyOnceWith(
      new URL(path, env.APP_URL).href,
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        headers: { Authorization: `Bearer ${key}` },
        signal: expect.any(AbortSignal),
      })
    );
  });
  it(`${path}: refuses manual execution before any call without the job credential`, async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await worker.fetch!(
      new Request("https://worker.example.invalid/", { method: "POST" }),
      env,
      context
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    expect(env.APP.fetch).not.toHaveBeenCalled();
  });
  it(`${path}: refuses alternate destinations and short keys without sending secrets`, async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const missingBinding = { ...env };
    Reflect.deleteProperty(missingBinding, "APP");
    for (const bad of [
      { ...env, APP_URL: "https://untrusted.example.invalid" },
      { ...env, APP_URL: "https://verifymzansi.com/other" },
      { ...env, WORKER_API_KEY: "short" },
      { ...env, APP_URL: "not a URL" },
      missingBinding,
    ])
      await expect(
        worker.scheduled!({ cron: "test", scheduledTime: 0 }, bad, context)
      ).rejects.toThrow("Invalid job configuration");
    expect(fetcher).not.toHaveBeenCalled();
    expect(env.APP.fetch).not.toHaveBeenCalled();
  });
  it(`${path}: reports app failure without leaking provider response bodies or credentials`, async () => {
    env.APP.fetch.mockResolvedValue(new Response("PRIVATE_PROVIDER_BODY", { status: 503 }));
    await expect(
      worker.scheduled!({ cron: "test", scheduledTime: 0 }, env, context)
    ).rejects.toThrow(/^App job returned HTTP 503$/);
  });
  it(`${path}: refuses a redirect without a second request or credential forwarding`, async () => {
    const external = vi.fn();
    vi.stubGlobal("fetch", external);
    env.APP.fetch.mockResolvedValue(
      new Response("", { status: 302, headers: { Location: "https://untrusted.example.invalid/" } })
    );
    await expect(
      worker.scheduled!({ cron: "test", scheduledTime: 0 }, env, context)
    ).rejects.toThrow("App job returned HTTP 302");
    expect(env.APP.fetch).toHaveBeenCalledOnce();
    expect(external).not.toHaveBeenCalled();
  });
}

it("retention runs every 5 minutes, as configured and as its health reply says", async () => {
  // A run the app cannot finish leaves 5-minute claims; the next run picks them up.
  const config = parse(readFileSync("wrangler.retention-cleanup.toml", "utf8")) as {
    triggers: { crons: string[] };
  };
  expect(config.triggers.crons).toEqual(["*/5 * * * *"]);
  const health = await retention.fetch!(
    new Request("https://worker.example.invalid/"),
    env,
    context
  );
  expect(await health.json()).toMatchObject({ schedule: config.triggers.crons[0] });
});

it("operations awaits its bound app job without sending the scoped key through public HTTP", async () => {
  const publicFetch = vi.fn();
  vi.stubGlobal("fetch", publicFetch);
  env.APP.fetch.mockResolvedValue(new Response("{}"));
  const waitUntil = vi.fn();
  await operations.scheduled(
    { cron: "test", scheduledTime: 0 },
    { ...env, OPS_JOBS_SECRET: key },
    { waitUntil, passThroughOnException: vi.fn() }
  );
  // Awaited in the handler itself, so a failure fails the scheduled run.
  expect(waitUntil).not.toHaveBeenCalled();
  expect(env.APP.fetch).toHaveBeenCalledExactlyOnceWith(
    "https://verifymzansi.com/api/webhooks/ops-jobs",
    expect.objectContaining({ redirect: "manual", headers: { Authorization: `Bearer ${key}` } })
  );
  expect(publicFetch).not.toHaveBeenCalled();
});

it("operations passes failures on so Cloudflare marks the run failed", async () => {
  const publicFetch = vi.fn();
  vi.stubGlobal("fetch", publicFetch);
  const opsEnv = {
    ...env,
    OPS_JOBS_SECRET: key,
    HEARTBEAT_URL_OPS_JOBS: "https://heartbeat.example.invalid/ops",
  };
  env.APP.fetch.mockResolvedValueOnce(new Response("PRIVATE_BODY", { status: 500 }));
  await expect(
    operations.scheduled({ cron: "test", scheduledTime: 0 }, opsEnv, context)
  ).rejects.toThrow(/^App job returned HTTP 500$/);
  env.APP.fetch.mockRejectedValueOnce(new Error(`network detail ${key}`));
  await expect(
    operations.scheduled({ cron: "test", scheduledTime: 0 }, opsEnv, context)
  ).rejects.toThrow(/^App job request failed$/);
  await expect(
    operations.scheduled(
      { cron: "test", scheduledTime: 0 },
      { ...opsEnv, OPS_JOBS_SECRET: "short" },
      context
    )
  ).rejects.toThrow("Invalid job configuration");
  // A failed run never reports itself healthy to the heartbeat monitor.
  expect(publicFetch).not.toHaveBeenCalled();
});

const heartbeatUrl = "https://heartbeat.example.invalid/ping/synthetic-heartbeat-token";
const timedJobs = [
  {
    name: "ops-jobs",
    run: (extra: Record<string, string>, cron = "test") =>
      operations.scheduled(
        { cron, scheduledTime: 0 },
        { ...env, OPS_JOBS_SECRET: key, ...extra },
        context
      ),
    variable: "HEARTBEAT_URL_OPS_JOBS",
  },
  {
    name: "payment-cleanup",
    run: (extra: Record<string, string>, cron = "test") =>
      payment.scheduled!({ cron, scheduledTime: 0 }, { ...env, ...extra }, context),
    variable: "HEARTBEAT_URL_PAYMENT_CLEANUP",
  },
  {
    name: "retention-cleanup",
    run: (extra: Record<string, string>, cron = "test") =>
      retention.scheduled!({ cron, scheduledTime: 0 }, { ...env, ...extra }, context),
    variable: "HEARTBEAT_URL_RETENTION_CLEANUP",
  },
] as const;

for (const job of timedJobs) {
  it(`${job.name}: pings its own heartbeat only after a successful run, without credentials`, async () => {
    const publicFetch = vi.fn().mockResolvedValue(new Response("OK"));
    vi.stubGlobal("fetch", publicFetch);
    env.APP.fetch.mockResolvedValue(new Response("{}"));
    // Another job's heartbeat variable is ignored.
    const others = Object.fromEntries(
      timedJobs.filter((other) => other !== job).map((other) => [other.variable, heartbeatUrl])
    );
    await job.run(others);
    expect(publicFetch).not.toHaveBeenCalled();
    await job.run({ [job.variable]: heartbeatUrl });
    expect(publicFetch).toHaveBeenCalledExactlyOnceWith(
      heartbeatUrl,
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        signal: expect.any(AbortSignal),
      })
    );
    const init = publicFetch.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(env.APP.fetch.mock.invocationCallOrder[1]).toBeLessThan(
      publicFetch.mock.invocationCallOrder[0]!
    );
  });

  it(`${job.name}: sends no heartbeat when the run fails`, async () => {
    const publicFetch = vi.fn().mockResolvedValue(new Response("OK"));
    vi.stubGlobal("fetch", publicFetch);
    env.APP.fetch.mockResolvedValue(new Response("", { status: 503 }));
    await expect(job.run({ [job.variable]: heartbeatUrl })).rejects.toThrow(
      "App job returned HTTP 503"
    );
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it(`${job.name}: a broken heartbeat never fails the run or logs its URL`, async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      env.APP.fetch.mockResolvedValue(new Response("{}"));
      for (const outcome of [
        () => Promise.reject(new TypeError(`fetch failed for ${heartbeatUrl}`)),
        () => Promise.reject(new DOMException("timed out", "TimeoutError")),
        () => Promise.resolve(new Response("down", { status: 500 })),
        () => Promise.resolve(new Response("", { status: 302, headers: { Location: "/" } })),
      ]) {
        vi.stubGlobal("fetch", vi.fn(outcome));
        await expect(job.run({ [job.variable]: heartbeatUrl })).resolves.toBeUndefined();
      }
      vi.stubGlobal("fetch", vi.fn());
      for (const bad of [
        "not a url",
        "http://heartbeat.example.invalid/x",
        "https://u:p@h.invalid/",
      ])
        await expect(job.run({ [job.variable]: bad })).resolves.toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
      const logged = JSON.stringify([warn.mock.calls, error.mock.calls, log.mock.calls]);
      expect(logged).not.toContain("synthetic-heartbeat-token");
      expect(logged).not.toContain("heartbeat.example.invalid");
      expect(logged).not.toContain("u:p@");
      expect(logged).not.toContain(key);
    } finally {
      warn.mockRestore();
      error.mockRestore();
      log.mockRestore();
    }
  });
}

for (const job of timedJobs.slice(1))
  it(`${job.name}: an authenticated manual run does not count as the schedule firing`, async () => {
    const publicFetch = vi.fn().mockResolvedValue(new Response("OK"));
    vi.stubGlobal("fetch", publicFetch);
    env.APP.fetch.mockResolvedValue(new Response("{}"));
    await job.run({ [job.variable]: heartbeatUrl }, "manual");
    expect(env.APP.fetch).toHaveBeenCalledOnce();
    expect(publicFetch).not.toHaveBeenCalled();
  });

it("payment and retention run the foundation path, which passes failures on", () => {
  // The retired source branches log and return; production must never take them.
  for (const name of ["payment-cleanup", "retention-cleanup"]) {
    const config = parse(readFileSync(`wrangler.${name}.toml`, "utf8")) as {
      vars: { DATA_BACKEND?: string };
    };
    expect(config.vars.DATA_BACKEND).toBe("foundation");
  }
});
