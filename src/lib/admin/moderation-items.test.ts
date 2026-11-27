import { describe, expect, it } from "vitest";
import { claimTypeOf } from "./moderation-items";

describe("moderation items", () => {
  it("claims edit requests separately from the posts they change", () => {
    expect(claimTypeOf({ isEditRequest: true, contentType: "business" })).toBe("content_edit");
    expect(claimTypeOf({ contentType: "promotion" })).toBe("promotion");
    expect(claimTypeOf({})).toBe("listing");
  });
});
