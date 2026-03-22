import { describe, expect, it, vi } from "vitest";
import rateLimiterWorker, { RateLimiterDO } from "../../workers/rate-limiter";

describe("rate-limiter worker", () => {
  it("rejects invalid external worker payloads", async () => {
    const res = await rateLimiterWorker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        headers: {
          Authorization: "Bearer worker-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "bad action" }),
      }),
      {
        WORKER_API_KEY: "worker-key",
        OTP_RATE_LIMITS: { get: vi.fn(), put: vi.fn() },
        RATE_LIMITER_DO: undefined as never,
      }
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "action contains invalid characters" });
  });

  it("rejects invalid durable-object checks payloads", async () => {
    const rateLimiterDo = new RateLimiterDO({
      storage: {
        get: vi.fn(),
        put: vi.fn(),
        setAlarm: vi.fn(),
        deleteAll: vi.fn(),
      },
    } as never);

    const res = await rateLimiterDo.fetch(
      new Request("https://do.internal/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checks: [] }),
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "At least one rate limit check is required",
    });
  });
});
