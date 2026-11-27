import { describe, expect, it } from "vitest";
import { defaultBrowse } from "./browse";
import { AREA_ORDER, nextArea, rolloverBrowse, rolloverCue } from "./rollover";

describe("area roll-over", () => {
  it("runs Tourism, Business, Market and loops", () => {
    expect(AREA_ORDER).toEqual(["tourism", "business", "market"]);
    expect(nextArea("tourism")).toBe("business");
    expect(nextArea("business")).toBe("market");
    expect(nextArea("market")).toBe("tourism");
  });

  it("goes back the other way", () => {
    expect(nextArea("tourism", -1)).toBe("market");
    expect(nextArea("market", -1)).toBe("business");
    expect(nextArea("business", -1)).toBe("tourism");
  });

  it("keeps the province and resets the area's own filters", () => {
    const from = {
      ...defaultBrowse("tourism", "KwaZulu-Natal"),
      kind: "events" as const,
      eventType: "music",
      sort: "newest" as const,
      query: "jazz",
    };
    expect(rolloverBrowse(from, "business")).toEqual(defaultBrowse("business", "KwaZulu-Natal"));
    expect(rolloverBrowse(defaultBrowse("market"), "tourism")).toEqual(defaultBrowse("tourism"));
  });

  it("brings back an area's earlier filters with the current province", () => {
    const earlier = { ...defaultBrowse("market", "Gauteng"), category: "vehicles" };
    const from = defaultBrowse("business", "Limpopo");
    expect(rolloverBrowse(from, "market", earlier)).toEqual({ ...earlier, province: "Limpopo" });
    // Another area's memory is never used.
    expect(rolloverBrowse(from, "tourism", earlier)).toEqual(defaultBrowse("tourism", "Limpopo"));
  });

  it("names the new area and the province in the cue", () => {
    expect(rolloverCue(defaultBrowse("business", "KwaZulu-Natal"))).toBe(
      "Business · KwaZulu-Natal"
    );
    expect(rolloverCue(defaultBrowse("market"))).toBe("Market");
  });
});
