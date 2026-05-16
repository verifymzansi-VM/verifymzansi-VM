import { describe, expect, it, vi } from "vitest";

import {
  applyVisibleExpiryFilter,
  getLegacyFreePostCutoffIso,
  isVisibleByExpiry,
} from "@/lib/posting/visibility";

describe("post visibility expiry", () => {
  it("filters out expired rows and old legacy rows at query time", () => {
    const query = {
      or: vi.fn().mockReturnThis(),
    };

    applyVisibleExpiryFilter(query, "2026-05-16T10:00:00.000Z");

    expect(query.or).toHaveBeenCalledWith(
      "expires_at.gt.2026-05-16T10:00:00.000Z,and(expires_at.is.null,created_at.gt.2026-05-09T10:00:00.000Z)"
    );
  });

  it("treats null-expiry legacy posts as invisible after the free visibility window", () => {
    const now = new Date("2026-05-16T10:00:00.000Z");

    expect(isVisibleByExpiry(null, now, "2026-05-10T10:00:00.000Z")).toBe(true);
    expect(isVisibleByExpiry(null, now, "2026-05-08T10:00:00.000Z")).toBe(false);
    expect(getLegacyFreePostCutoffIso(now)).toBe("2026-05-09T10:00:00.000Z");
  });
});
