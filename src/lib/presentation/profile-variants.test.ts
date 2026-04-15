import { describe, expect, it } from "vitest";
import {
  resolveBusinessProfileFamily,
  resolveMarketProfileVariant,
  resolvePromotionProfileFamily,
} from "./profile-variants";

describe("profile variants", () => {
  it("maps market categories into presentation buckets", () => {
    expect(resolveMarketProfileVariant("property")).toBe("property");
    expect(resolveMarketProfileVariant("vehicles")).toBe("motors");
    expect(resolveMarketProfileVariant("jobs_services")).toBe("services");
    expect(resolveMarketProfileVariant("electronics")).toBe("catalog");
  });

  it("maps business categories into profile families", () => {
    expect(resolveBusinessProfileFamily("tourism_hospitality", "standalone_shop")).toBe("tourism");
    expect(resolveBusinessProfileFamily("professional_services", "online_only")).toBe(
      "professional"
    );
    expect(resolveBusinessProfileFamily("fashion_accessories", "standalone_shop")).toBe("showroom");
  });

  it("keeps promotions on the event profile family", () => {
    expect(resolvePromotionProfileFamily()).toBe("event");
  });
});
