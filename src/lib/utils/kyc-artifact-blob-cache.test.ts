import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCachedKycArtifactBlob,
  setCachedKycArtifactBlob,
  clearCachedKycArtifactBlobs,
} from "./kyc-artifact-blob-cache";

describe("kyc-artifact-blob-cache", () => {
  beforeEach(() => {
    clearCachedKycArtifactBlobs();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for uncached artifact", () => {
    expect(getCachedKycArtifactBlob("missing-id")).toBeNull();
  });

  it("caches and retrieves a blob", () => {
    const blob = new Blob(["test"], { type: "image/jpeg" });
    setCachedKycArtifactBlob("art-1", blob);
    expect(getCachedKycArtifactBlob("art-1")).toBe(blob);
  });

  it("expires entries after TTL (10 minutes)", () => {
    const blob = new Blob(["data"]);
    setCachedKycArtifactBlob("art-2", blob);

    // Advance 9 minutes — should still be cached
    vi.advanceTimersByTime(9 * 60 * 1000);
    expect(getCachedKycArtifactBlob("art-2")).toBe(blob);

    // Advance past 10 minutes
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(getCachedKycArtifactBlob("art-2")).toBeNull();
  });

  it("evicts oldest entries when exceeding MAX_ENTRIES (30)", () => {
    for (let i = 0; i < 35; i++) {
      setCachedKycArtifactBlob(`art-${i}`, new Blob([`data-${i}`]));
    }

    // First 5 entries should have been evicted
    for (let i = 0; i < 5; i++) {
      expect(getCachedKycArtifactBlob(`art-${i}`)).toBeNull();
    }

    // Entries 5–34 should still be present
    for (let i = 5; i < 35; i++) {
      expect(getCachedKycArtifactBlob(`art-${i}`)).not.toBeNull();
    }
  });

  it("clearCachedKycArtifactBlobs removes all entries", () => {
    setCachedKycArtifactBlob("art-a", new Blob(["a"]));
    setCachedKycArtifactBlob("art-b", new Blob(["b"]));
    clearCachedKycArtifactBlobs();
    expect(getCachedKycArtifactBlob("art-a")).toBeNull();
    expect(getCachedKycArtifactBlob("art-b")).toBeNull();
  });
});
