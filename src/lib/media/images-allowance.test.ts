/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cloudflare = vi.hoisted(() => ({
  inWorker: false,
  env: {} as Record<string, unknown>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => {
    if (!cloudflare.inWorker) throw new Error("not in a Worker");
    return { env: cloudflare.env };
  },
}));

import {
  imagesUsageKey,
  IMAGES_FREE_MONTHLY_TRANSFORMATIONS,
  openImagesAllowance,
  PHOTO_COPY_BUDGET,
  recordImagesTransformations,
} from "./images-allowance";

const now = new Date("2026-11-30T23:59:00Z");
const key = "images-transformations:2026-11";

function kv(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: vi.fn(async (name: string) => values.get(name) ?? null),
    put: vi.fn(async (name: string, value: string) => {
      values.set(name, value);
    }),
  };
}

beforeEach(() => {
  cloudflare.inWorker = true;
  cloudflare.env = {};
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Images allowance count", () => {
  it("keeps 40% of the free monthly allowance for re-encodes", () => {
    expect(IMAGES_FREE_MONTHLY_TRANSFORMATIONS).toBe(5000);
    expect(PHOTO_COPY_BUDGET).toBe(3000);
    expect(imagesUsageKey(now)).toBe(key);
    expect(imagesUsageKey(new Date("2026-12-01T00:00:00Z"))).toBe("images-transformations:2026-12");
  });

  it("allows copies under the budget and saves the upload's count with one write", async () => {
    const store = kv({ [key]: "2997" });
    cloudflare.env.OTP_RATE_LIMITS = store;
    const allowance = await openImagesAllowance(now);
    allowance.add(1);
    expect(await allowance.allowsCopies(1)).toBe(true);
    allowance.add(1);
    expect(await allowance.allowsCopies(2)).toBe(false);
    store.values.set(key, "2998"); // another upload saved meanwhile
    await allowance.save();
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledWith(key, "3000", { expirationTtl: 40 * 24 * 60 * 60 });
    await allowance.save();
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it("stops copies at the budget while re-encodes are still counted", async () => {
    const store = kv({ [key]: String(PHOTO_COPY_BUDGET) });
    cloudflare.env.OTP_RATE_LIMITS = store;
    const allowance = await openImagesAllowance(now);
    allowance.add(1);
    expect(await allowance.allowsCopies(1)).toBe(false);
    await allowance.save();
    expect(store.values.get(key)).toBe(String(PHOTO_COPY_BUDGET + 1));
  });

  it("makes no copies when the count cannot be read, and never throws", async () => {
    cloudflare.env.OTP_RATE_LIMITS = {
      get: vi.fn(async () => {
        throw new Error("KV unavailable");
      }),
      put: vi.fn(async () => {
        throw new Error("KV unavailable");
      }),
    };
    const allowance = await openImagesAllowance(now);
    expect(await allowance.allowsCopies(1)).toBe(false);
    allowance.add(1);
    await expect(allowance.save()).resolves.toBeUndefined();
    await expect(allowance.markUsedUp()).resolves.toBeUndefined();
  });

  it("makes no copies on Workers without the counter binding", async () => {
    const allowance = await openImagesAllowance(now);
    expect(await allowance.allowsCopies(1)).toBe(false);
    allowance.add(1);
    await expect(allowance.save()).resolves.toBeUndefined();
  });

  it("treats a damaged count as used up (no copies)", async () => {
    cloudflare.env.OTP_RATE_LIMITS = kv({ [key]: "not a number" });
    expect(await (await openImagesAllowance(now)).allowsCopies(1)).toBe(false);
  });

  it("reads the count only when copies are asked about", async () => {
    const store = kv({ [key]: "10" });
    cloudflare.env.OTP_RATE_LIMITS = store;
    const allowance = await openImagesAllowance(now);
    expect(store.get).not.toHaveBeenCalled();
    allowance.add(1);
    await allowance.save();
    expect(store.get).toHaveBeenCalledTimes(1);
    expect(store.values.get(key)).toBe("11");
  });

  it("marks the month used up after a 9422, so copies stop even if the count lagged", async () => {
    const store = kv({ [key]: "120" });
    cloudflare.env.OTP_RATE_LIMITS = store;
    await (await openImagesAllowance(now)).markUsedUp();
    expect(store.values.get(key)).toBe(String(IMAGES_FREE_MONTHLY_TRANSFORMATIONS));
    expect(await (await openImagesAllowance(now)).allowsCopies(1)).toBe(false);
    store.values.set(key, "6000");
    await (await openImagesAllowance(now)).markUsedUp();
    expect(store.values.get(key)).toBe("6000");
  });

  it("counts verification image re-encodes", async () => {
    const store = kv();
    cloudflare.env.OTP_RATE_LIMITS = store;
    await recordImagesTransformations(1);
    expect(store.values.get(imagesUsageKey(new Date()))).toBe("1");
  });

  it("allows copies and counts nothing outside Workers (sharp, no allowance)", async () => {
    cloudflare.inWorker = false;
    const allowance = await openImagesAllowance(now);
    expect(await allowance.allowsCopies(PHOTO_COPY_BUDGET * 2)).toBe(true);
    allowance.add(1);
    await expect(allowance.save()).resolves.toBeUndefined();
  });
});
