import { describe, expect, it } from "vitest";

import {
  getApprovedPostExpiryIso,
  getFreePostExpiryIso,
  getPaidPostExpiryIso,
  getPostExpiryIso,
  getPostVisibilityDurationDaysFromStoredExpiry,
} from "./post-lifecycle";

describe("post lifecycle expiry", () => {
  const baseDate = new Date("2026-05-16T10:00:00.000Z");

  it("expires free posts after 7 days", () => {
    expect(getFreePostExpiryIso(baseDate)).toBe("2026-05-23T10:00:00.000Z");
    expect(getPostExpiryIso({ hasPaidPlan: false }, baseDate)).toBe("2026-05-23T10:00:00.000Z");
  });

  it("expires paid posts after 30 days", () => {
    expect(getPaidPostExpiryIso(baseDate)).toBe("2026-06-15T10:00:00.000Z");
    expect(getPostExpiryIso({ hasPaidPlan: true }, baseDate)).toBe("2026-06-15T10:00:00.000Z");
  });

  it("preserves free post visibility duration when approved after moderation", () => {
    expect(
      getApprovedPostExpiryIso(
        {
          createdAt: "2026-05-16T10:00:00.000Z",
          expiresAt: "2026-05-23T10:00:00.000Z",
        },
        new Date("2026-05-18T08:00:00.000Z")
      )
    ).toBe("2026-05-25T08:00:00.000Z");
  });

  it("preserves paid post visibility duration when approved after moderation", () => {
    expect(
      getApprovedPostExpiryIso(
        {
          createdAt: "2026-05-16T10:00:00.000Z",
          expiresAt: "2026-06-15T10:00:00.000Z",
        },
        new Date("2026-05-18T08:00:00.000Z")
      )
    ).toBe("2026-06-17T08:00:00.000Z");
  });

  it("treats legacy null expiry rows as paid visibility", () => {
    expect(
      getPostVisibilityDurationDaysFromStoredExpiry({
        createdAt: "2026-05-16T10:00:00.000Z",
        expiresAt: null,
      })
    ).toBe(30);
  });
});
