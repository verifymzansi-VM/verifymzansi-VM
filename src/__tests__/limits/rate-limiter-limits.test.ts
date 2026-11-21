/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import rateLimiterWorker from "../../../workers/rate-limiter";

/**
 * Register-driven check of the shared rate limiter (workers/rate-limiter.ts)
 * against docs/testing/limits-register.json: for every "LIM-RL-*" entry, each
 * tier allows a request one below its limit, refuses one at its limit (429
 * with Retry-After equal to the tier's window), and an allowed request counts
 * against exactly the register's tiers, no more and no fewer. Changing a
 * limit in the worker without changing the register (or the reverse) fails
 * here. The fallback (KV) path is used because its counters can be seeded;
 * the Durable Object path reads the same table (rate-limiter-worker.test.ts).
 */

interface Tier {
  limit: number;
  ttl: number;
}
interface RateEntry {
  id: string;
  action?: string;
  tiers?: Tier[];
  deviceTier?: Tier;
}

const register = JSON.parse(
  readFileSync(join(process.cwd(), "docs/testing/limits-register.json"), "utf8")
) as { limits: RateEntry[] };
const rateEntries = register.limits.filter((entry) => entry.id.startsWith("LIM-RL-"));
const actionEntries = rateEntries.filter((entry) => entry.action);

function kv(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
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

async function call(body: Record<string, unknown>, seed: Record<string, string> = {}) {
  const { store, namespace } = kv(seed);
  const response = await rateLimiterWorker.fetch(
    new Request("https://worker.example", {
      method: "POST",
      headers: { Authorization: "Bearer worker-key", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { WORKER_API_KEY: "worker-key", OTP_RATE_LIMITS: namespace } as never
  );
  return { response, store };
}

const KEY = "198.51.100.77";
const counter = (action: string, ttl: number) => `${action}:${KEY}:${ttl}`;

describe("limits register: shared rate limiter", () => {
  it("has a register entry with tiers for every action", () => {
    expect(actionEntries.length).toBeGreaterThan(50);
    for (const entry of actionEntries) {
      expect(entry.tiers?.length, entry.id).toBeGreaterThan(0);
      for (const tier of entry.tiers ?? []) {
        expect(Number.isInteger(tier.limit) && tier.limit > 0, entry.id).toBe(true);
        expect(Number.isInteger(tier.ttl) && tier.ttl > 0, entry.id).toBe(true);
      }
    }
  });

  describe.each(actionEntries.map((entry) => [entry.id, entry] as const))("%s", (_id, entry) => {
    const action = entry.action as string;
    const tiers = entry.tiers as Tier[];

    it.each(tiers.map((tier) => [tier.limit, tier.ttl] as const))(
      "allows request %i of its %is window and refuses the next",
      async (limit, ttl) => {
        const below = await call(
          { action, key: KEY },
          { [counter(action, ttl)]: String(limit - 1) }
        );
        expect(below.response.status).toBe(200);
        const at = await call({ action, key: KEY }, { [counter(action, ttl)]: String(limit) });
        expect(at.response.status).toBe(429);
        expect(at.response.headers.get("Retry-After")).toBe(String(ttl));
        expect(at.response.headers.get("X-RateLimit-Limit")).toBe(String(limit));
      }
    );

    it("counts an allowed request against exactly the register's tiers", async () => {
      const { response, store } = await call({ action, key: KEY });
      expect(response.status).toBe(200);
      expect([...store.keys()].sort()).toEqual(
        tiers.map((tier) => counter(action, tier.ttl)).sort()
      );
    });
  });

  it("LIM-RL-unknown-action-default: an action missing from the table gets 30 a minute", async () => {
    const action = "limits-register:not-a-real-action";
    expect(actionEntries.some((entry) => entry.action === action)).toBe(false);
    expect(
      (await call({ action, key: KEY }, { [counter(action, 60)]: "29" })).response.status
    ).toBe(200);
    const at = await call({ action, key: KEY }, { [counter(action, 60)]: "30" });
    expect(at.response.status).toBe(429);
    expect(at.response.headers.get("Retry-After")).toBe("60");
  });

  it("LIM-RL-otp-phone: the phone path's tiers per number and per device", async () => {
    const entry = rateEntries.find((candidate) => candidate.id === "LIM-RL-otp-phone");
    expect(entry?.tiers).toBeDefined();
    const phone = "+27821234567";
    const keys = ["otp:send", "otp:hour", "otp:day"].map((prefix) => `${prefix}:${phone}`);
    const tiers = entry?.tiers as Tier[];
    for (const [index, tier] of tiers.entries()) {
      const below = await call({ key: "0821234567" }, { [keys[index]]: String(tier.limit - 1) });
      expect(below.response.status).toBe(200);
      const at = await call({ key: "0821234567" }, { [keys[index]]: String(tier.limit) });
      expect(at.response.status).toBe(429);
      expect(at.response.headers.get("Retry-After")).toBe(String(tier.ttl));
    }
    const device = entry?.deviceTier as Tier;
    const deviceKey = "otp:device:device-1";
    expect(
      (await call({ key: phone, deviceId: "device-1" }, { [deviceKey]: String(device.limit - 1) }))
        .response.status
    ).toBe(200);
    const blocked = await call(
      { key: phone, deviceId: "device-1" },
      { [deviceKey]: String(device.limit) }
    );
    expect(blocked.response.status).toBe(429);
    expect(blocked.response.headers.get("Retry-After")).toBe(String(device.ttl));
    const { store } = await call({ key: phone, deviceId: "device-2" });
    expect([...store.keys()].sort()).toEqual([...keys, "otp:device:device-2"].sort());
  });
});
