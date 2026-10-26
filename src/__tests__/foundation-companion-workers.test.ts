/** @vitest-environment node */
import { afterEach, expect, it, vi } from "vitest";
import payment from "../../workers/payment-cleanup";
import retention from "../../workers/retention-cleanup";
const key = "synthetic-companion-job-credential-".repeat(2);
const env = {
  DATA_BACKEND: "foundation" as const,
  APP_URL: "https://verifymzansi.com",
  WORKER_API_KEY: key,
};
const context = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
afterEach(() => vi.unstubAllGlobals());
for (const [worker, path] of [
  [payment, "/api/internal/payments/reconcile"],
  [retention, "/api/internal/retention/run"],
] as const) {
  it(`${path}: delegates once without any database or storage binding`, async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    await worker.scheduled!({ cron: "test", scheduledTime: 0 }, env, context);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      new URL(path, env.APP_URL),
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
  });
  it(`${path}: refuses alternate destinations and short keys without sending secrets`, async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const bad of [
      { ...env, APP_URL: "https://untrusted.example.invalid" },
      { ...env, APP_URL: "https://verifymzansi.com/other" },
      { ...env, WORKER_API_KEY: "short" },
    ])
      await expect(
        worker.scheduled!({ cron: "test", scheduledTime: 0 }, bad, context)
      ).rejects.toThrow("Invalid job configuration");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it(`${path}: reports app failure without leaking provider response bodies or credentials`, async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("PRIVATE_PROVIDER_BODY", { status: 503 }))
    );
    await expect(
      worker.scheduled!({ cron: "test", scheduledTime: 0 }, env, context)
    ).rejects.toThrow(/^Foundation job returned HTTP 503$/);
  });
}
