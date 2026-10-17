import { describe, it, expect } from "vitest";
import {
  validatePostTaxonomy,
  listPostCategories,
  listCategoryActivities,
  parsePostLocality,
  resolveReferenceCity,
} from "./catalog";
describe("canonical post reference contract", () => {
  it("keeps tourism businesses and events in Tourism & Events with distinct kinds", () => {
    expect(
      validatePostTaxonomy({
        kind: "business",
        area: "tourism_events",
        category_key: "tourism_hospitality",
        activity_key: "tour_operator",
      }).activity_key
    ).toBe("tour_operator");
    expect(
      validatePostTaxonomy({
        kind: "event",
        area: "tourism_events",
        category_key: "events",
        activity_key: "festival_concert",
      }).kind
    ).toBe("event");
    expect(listPostCategories("business").some((c) => c.key === "tourism_hospitality")).toBe(false);
    expect(
      listCategoryActivities("tourism_hospitality").find((a) => a.key === "hotel_resort")
        ?.fieldGroup
    ).toBe("A");
  });
  it.each([
    { kind: "listing", area: "business", category_key: "electronics" },
    {
      kind: "business",
      area: "business",
      category_key: "tourism_hospitality",
      activity_key: "hotel_resort",
    },
    {
      kind: "business",
      area: "tourism_events",
      category_key: "events",
      activity_key: "festival_concert",
    },
    { kind: "event", area: "tourism_events", category_key: "events" },
    { kind: "business", area: "business", category_key: "health_beauty" },
    { kind: "business", area: "business", category_key: "automotive_transport" },
    { kind: "event", area: "tourism_events", category_key: "events", activity_key: "hotel_resort" },
    {
      kind: "listing",
      area: "market",
      category_key: "electronics",
      activity_key: "festival_concert",
    },
    { kind: "listing", area: "market", category_key: "electronics", owner_id: "injected" },
  ])("rejects incompatible/retired/overbroad context %j", (input) =>
    expect(() => validatePostTaxonomy(input)).toThrow()
  );
  it("retains known aliases without confusing provinces or claiming verified account location", () => {
    expect(resolveReferenceCity("ec", "Gqeberha")).toBe("ec_port_elizabeth_gqeberha");
    expect(resolveReferenceCity("mp", "Nelspruit")).toBe("mp_mbombela_nelspruit");
    expect(resolveReferenceCity("gp", "Cape Town")).toBe(null);
    expect(
      parsePostLocality({
        province_id: "gp",
        city_label: "An unlisted town",
        town_label: "x".repeat(120),
      })
    ).toMatchObject({ city_id: null, city_label: "An unlisted town", assertion: "self_declared" });
  });
  it.each([
    { province_id: "gp", city_id: "wc_cape_town" },
    { province_id: "gp", city_id: "gp_johannesburg", city_label: "Cape Town" },
    { province_id: "gp" },
    { province_id: "invented", city_label: "Town" },
    { province_id: "gp", city_label: "Hidden\u202etown" },
    { province_id: "gp", city_id: "gp_johannesburg", address: "private street" },
    { province_id: "gp", city_id: "gp_johannesburg", verified: true },
  ])("rejects wrong/injected locality %j", (input) =>
    expect(() => parsePostLocality(input)).toThrow()
  );
});
