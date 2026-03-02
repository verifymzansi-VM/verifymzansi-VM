import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  cacheable,
  invalidateCache,
  invalidateCacheByPrefix,
  clearCache,
  getCacheStats,
} from "./cache";

describe("cache service", () => {
  beforeEach(() => {
    clearCache();
  });

  describe("cacheable", () => {
    it("calls fetcher on cache miss and returns result", async () => {
      const fetcher = vi.fn().mockResolvedValue({ name: "test" });

      const result = await cacheable("key-1", fetcher);
      expect(result).toEqual({ name: "test" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("returns cached value on cache hit without calling fetcher", async () => {
      const fetcher = vi.fn().mockResolvedValue("value-1");

      await cacheable("key-2", fetcher, 60_000);
      const result = await cacheable("key-2", fetcher, 60_000);

      expect(result).toBe("value-1");
      expect(fetcher).toHaveBeenCalledTimes(1); // Only called once
    });

    it("refetches when cache entry has expired", async () => {
      const fetcher = vi.fn().mockResolvedValueOnce("stale").mockResolvedValueOnce("fresh");

      // TTL of 1ms so it expires immediately
      await cacheable("key-3", fetcher, 1);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await cacheable("key-3", fetcher, 60_000);
      expect(result).toBe("fresh");
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("deduplicates concurrent fetches for the same key (singleflight)", async () => {
      let resolvePromise: (value: string) => void;
      const fetcher = vi.fn().mockReturnValue(
        new Promise<string>((resolve) => {
          resolvePromise = resolve;
        })
      );

      // Start two concurrent fetches for the same key
      const p1 = cacheable("key-4", fetcher, 60_000);
      const p2 = cacheable("key-4", fetcher, 60_000);

      // Resolve the pending fetch
      resolvePromise!("shared-value");

      const [result1, result2] = await Promise.all([p1, p2]);

      expect(result1).toBe("shared-value");
      expect(result2).toBe("shared-value");
      expect(fetcher).toHaveBeenCalledTimes(1); // Only one fetch
    });

    it("does not share results between different keys", async () => {
      const fetcher1 = vi.fn().mockResolvedValue("a");
      const fetcher2 = vi.fn().mockResolvedValue("b");

      const [r1, r2] = await Promise.all([
        cacheable("key-5a", fetcher1),
        cacheable("key-5b", fetcher2),
      ]);

      expect(r1).toBe("a");
      expect(r2).toBe("b");
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).toHaveBeenCalledTimes(1);
    });

    it("handles fetcher errors without poisoning the cache", async () => {
      const fetcher = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce("recovered");

      await expect(cacheable("key-6", fetcher)).rejects.toThrow("fail");

      // Retry should call fetcher again (not stuck in inflight)
      const result = await cacheable("key-6", fetcher);
      expect(result).toBe("recovered");
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe("invalidateCache", () => {
    it("removes a specific key from the cache", async () => {
      const fetcher = vi.fn().mockResolvedValue("value");

      await cacheable("invalidate-key", fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);

      invalidateCache("invalidate-key");

      await cacheable("invalidate-key", fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2); // Called again after invalidation
    });
  });

  describe("invalidateCacheByPrefix", () => {
    it("removes all keys matching the prefix", async () => {
      const fetcher = vi.fn().mockResolvedValue("value");

      await cacheable("prefix:a", fetcher);
      await cacheable("prefix:b", fetcher);
      await cacheable("other:c", fetcher);

      invalidateCacheByPrefix("prefix:");

      const stats = getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.keys).toEqual(["other:c"]);
    });
  });

  describe("clearCache", () => {
    it("removes all entries", async () => {
      const fetcher = vi.fn().mockResolvedValue("value");

      await cacheable("clear-1", fetcher);
      await cacheable("clear-2", fetcher);

      clearCache();

      const stats = getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.keys).toEqual([]);
    });
  });

  describe("getCacheStats", () => {
    it("returns size and keys", async () => {
      const fetcher = vi.fn().mockResolvedValue("value");

      await cacheable("stat-1", fetcher);
      await cacheable("stat-2", fetcher);

      const stats = getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain("stat-1");
      expect(stats.keys).toContain("stat-2");
    });
  });
});
