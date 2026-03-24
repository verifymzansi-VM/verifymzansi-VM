import { describe, expect, it, vi } from "vitest";
import rateLimiterWorker, { RateLimiterDO } from "../../workers/rate-limiter";

interface MemoryStorage {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  setAlarm: ReturnType<typeof vi.fn>;
  deleteAll: ReturnType<typeof vi.fn>;
}

function createMemoryStorage(): MemoryStorage {
  const store = new Map<string, unknown>();

  return {
    get: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    setAlarm: vi.fn(async () => {}),
    deleteAll: vi.fn(async () => {
      store.clear();
    }),
  };
}

function createKvNamespace() {
  const store = new Map<string, string>();

  return {
    store,
    namespace: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    },
  };
}

function createDurableObjectNamespace() {
  const instances = new Map<string, RateLimiterDO>();

  return {
    idFromName: vi.fn((name: string) => name as never),
    get: vi.fn((id: string) => ({
      fetch: (input: RequestInfo, init?: RequestInit) => {
        let instance = instances.get(id);
        if (!instance) {
          instance = new RateLimiterDO({ storage: createMemoryStorage() } as never);
          instances.set(id, instance);
        }

        const request =
          input instanceof Request ? input : new Request(String(input), init ?? { method: "POST" });
        return instance.fetch(request);
      },
    })),
  };
}

function createWorkerEnv({ useDurableObject = true }: { useDurableObject?: boolean } = {}) {
  const kv = createKvNamespace();

  return {
    kvStore: kv.store,
    env: {
      WORKER_API_KEY: "worker-key",
      OTP_RATE_LIMITS: kv.namespace,
      RATE_LIMITER_DO: useDurableObject ? createDurableObjectNamespace() : undefined,
    },
  };
}

function createWorkerRequest(action: string, key: string): Request {
  return new Request("https://worker.example", {
    method: "POST",
    headers: {
      Authorization: "Bearer worker-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, key }),
  });
}

describe("rate-limiter worker", () => {
  it("rejects invalid external worker payloads", async () => {
    const { env } = createWorkerEnv({ useDurableObject: false });
    const res = await rateLimiterWorker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        headers: {
          Authorization: "Bearer worker-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "bad action" }),
      }),
      env as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "action contains invalid characters" });
  });

  it("rejects invalid durable-object checks payloads", async () => {
    const rateLimiterDo = new RateLimiterDO({
      storage: createMemoryStorage(),
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

  it("allows exactly 10 auth:register requests before blocking the 11th", async () => {
    const { env } = createWorkerEnv();

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const res = await rateLimiterWorker.fetch(
        createWorkerRequest("auth:register", "198.51.100.10"),
        env as never
      );
      expect(res.status).toBe(200);
    }

    const limited = await rateLimiterWorker.fetch(
      createWorkerRequest("auth:register", "198.51.100.10"),
      env as never
    );

    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({
      error: "rate_limited",
      retryAfter: expect.any(Number),
    });
  });

  it("allows exactly 20 verification:session-start requests before blocking the 21st", async () => {
    const { env } = createWorkerEnv();

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const res = await rateLimiterWorker.fetch(
        createWorkerRequest("verification:session-start", "user-123"),
        env as never
      );
      expect(res.status).toBe(200);
    }

    const limited = await rateLimiterWorker.fetch(
      createWorkerRequest("verification:session-start", "user-123"),
      env as never
    );

    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({
      error: "rate_limited",
      retryAfter: expect.any(Number),
    });
  });

  it("stores generic fallback counters per tier instead of reusing one key", async () => {
    const { env, kvStore } = createWorkerEnv({ useDurableObject: false });

    const res = await rateLimiterWorker.fetch(
      createWorkerRequest("auth:register", "203.0.113.5"),
      env as never
    );

    expect(res.status).toBe(200);
    expect(kvStore.get("auth:register:203.0.113.5:600")).toBe("1");
    expect(kvStore.get("auth:register:203.0.113.5:3600")).toBe("1");
  });
});
