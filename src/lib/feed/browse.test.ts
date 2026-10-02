import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  cleanBrowseQuery,
  defaultBrowse,
  describeBrowse,
  parseBrowse,
  serializeBrowse,
} from "./browse";

describe("browse filters", () => {
  it("round-trips a full choice through the address", () => {
    const browse = {
      ...defaultBrowse("market", "Gauteng"),
      category: "vehicles",
      condition: "good",
      sort: "price_asc" as const,
      query: "bmw",
    };
    expect(parseBrowse(new URLSearchParams(serializeBrowse(browse)))).toEqual(browse);
    expect(activeFilterCount(browse)).toBe(4);
  });

  it("refuses values that are not on the site's own lists", () => {
    expect(parseBrowse(new URLSearchParams("v=admin"))).toBeNull();
    expect(parseBrowse(new URLSearchParams("v=market&province=Atlantis"))).toBeNull();
    expect(parseBrowse(new URLSearchParams("v=market&category=weapons"))).toBeNull();
    // Conditions and price sorts belong to the Market only.
    expect(parseBrowse(new URLSearchParams("v=business&condition=good"))).toBeNull();
    expect(parseBrowse(new URLSearchParams("v=business&sort=price_asc"))).toBeNull();
    expect(parseBrowse(new URLSearchParams("v=market&kind=events"))).toBeNull();
  });

  it("accepts tourism kinds and event types", () => {
    expect(
      parseBrowse(new URLSearchParams("v=tourism&kind=events&eventType=festival_concert"))
    ).toMatchObject({ kind: "events", eventType: "festival_concert" });
  });

  it("cleans search words to letters, numbers and spaces", () => {
    expect(cleanBrowseQuery("  BMW*,  320i!! ")).toBe("BMW 320i");
    expect(cleanBrowseQuery("%%%")).toBeNull();
    expect(cleanBrowseQuery("a".repeat(80))).toHaveLength(60);
  });

  it("describes the choice in plain words", () => {
    expect(describeBrowse(defaultBrowse("tourism", "Limpopo"))).toBe("Tourism & Events in Limpopo");
    expect(describeBrowse({ ...defaultBrowse("tourism"), kind: "events" })).toBe(
      "Events in all of South Africa"
    );
  });
});
