import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/lib/services/entitlements", () => ({
  getEntitlements: vi.fn((tier: string, _area: string) => {
    if (tier === "pro") {
      return {
        maxAllowed: 50,
        maxPhotos: 20,
        maxVideos: 5,
        maxPostsPerMonth: 30,
        videoAllowed: true,
        boostAllowed: true,
        featuredAllowed: true,
        urgentAllowed: true,
      };
    }
    if (tier === "basic") {
      return {
        maxAllowed: 5,
        maxPhotos: 10,
        maxVideos: 1,
        maxPostsPerMonth: 5,
        videoAllowed: true,
        boostAllowed: false,
        featuredAllowed: false,
        urgentAllowed: false,
      };
    }
    return null;
  }),
}));

import { useEntitlements } from "./use-entitlements";

describe("useEntitlements", () => {
  it("returns default entitlements for basic tier", () => {
    const { result } = renderHook(() => useEntitlements("basic", "MZANSI_MARKET"));
    expect(result.current.planTier).toBe("basic");
    expect(result.current.maxListings).toBe(5);
    expect(result.current.canBoost).toBe(false);
    expect(result.current.canUploadVideo).toBe(true);
  });

  it("returns pro entitlements", () => {
    const { result } = renderHook(() => useEntitlements("pro", "MZANSI_MARKET"));
    expect(result.current.maxListings).toBe(50);
    expect(result.current.canBoost).toBe(true);
    expect(result.current.canFeature).toBe(true);
    expect(result.current.canUploadVideo).toBe(true);
    expect(result.current.maxPhotos).toBe(20);
  });

  it("falls back to defaults when getEntitlements returns null", () => {
    const { result } = renderHook(() => useEntitlements("starter", "MZANSI_MARKET"));
    // Falls back to ?? defaults in the hook (maxPhotos ?? 3, maxAllowed ?? 2)
    expect(result.current.maxListings).toBe(2);
    expect(result.current.canBoost).toBe(false);
    expect(result.current.canUploadVideo).toBe(false);
    expect(result.current.maxPhotos).toBe(3);
  });
});
