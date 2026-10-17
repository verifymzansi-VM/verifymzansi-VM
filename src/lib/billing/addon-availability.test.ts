import { describe, expect, it } from "vitest";
import { isAddonOffered } from "./addon-availability";

describe("isAddonOffered", () => {
  it("keeps Urgent on sale for every post", () => {
    expect(isAddonOffered("urgent", "listing")).toBe(true);
    expect(isAddonOffered("urgent", "business")).toBe(true);
    expect(isAddonOffered("urgent", "promotion", "deal")).toBe(true);
  });

  it("sells Boost and Featured only for events, where they change the order", () => {
    for (const kind of ["boost", "featured"] as const) {
      expect(isAddonOffered(kind, "promotion", "event")).toBe(true);
      expect(isAddonOffered(kind, "promotion", "deal")).toBe(false);
      expect(isAddonOffered(kind, "promotion", null)).toBe(false);
      expect(isAddonOffered(kind, "listing")).toBe(false);
      expect(isAddonOffered(kind, "business")).toBe(false);
    }
  });
});
