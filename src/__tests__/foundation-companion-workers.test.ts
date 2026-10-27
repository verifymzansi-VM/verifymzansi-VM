/** @vitest-environment node */
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

it("operations awaits its bound app job without sending the scoped key through public HTTP", async () => {
  const publicFetch = vi.fn();
  vi.stubGlobal("fetch", publicFetch);
  env.APP.fetch.mockResolvedValue(new Response("{}"));
  const jobs: Promise<unknown>[] = [];
  await operations.scheduled(
    { cron: "test", scheduledTime: 0 },
    { ...env, OPS_JOBS_SECRET: key },
    {
      waitUntil: (job) => jobs.push(job),
      passThroughOnException: vi.fn(),
    }
  );
  await Promise.all(jobs);
  expect(env.APP.fetch).toHaveBeenCalledExactlyOnceWith(
    "https://verifymzansi.com/api/webhooks/ops-jobs",
    expect.objectContaining({ redirect: "manual", headers: { Authorization: `Bearer ${key}` } })
  );
  expect(publicFetch).not.toHaveBeenCalled();
});
