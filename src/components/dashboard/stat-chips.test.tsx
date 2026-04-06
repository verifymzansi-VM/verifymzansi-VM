import { describe, expect, it } from "vitest";
import { defaultChips } from "./stat-chips";

describe("defaultChips", () => {
  it("uses Tourism & Events for the fourth dashboard card", () => {
    const chips = defaultChips({
      liveListings: 5,
      unreadLeads: 2,
      businesses: 3,
      activePromos: 4,
    });

    expect(chips).toHaveLength(4);
    expect(chips[3]).toMatchObject({
      label: "Tourism & Events",
      href: "/dashboard/promotions",
      value: 4,
    });
  });
});
