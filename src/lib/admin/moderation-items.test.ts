import { describe, expect, it } from "vitest";
import { businessItem, claimTypeOf, promotionItem } from "./moderation-items";

describe("moderation items", () => {
  it("files tourism businesses under Tourism & Events, and the rest under Mzansi Business", () => {
    expect(
      businessItem({
        business_name: "B&B",
        area: "MZANSI_BUSINESS",
        category: "tourism_hospitality",
      })
    ).toMatchObject({ area: "PROMOTIONS_EVENTS", itemType: "Tourism business", title: "B&B" });
    expect(
      businessItem({ business_name: "Salon", area: "MZANSI_BUSINESS", category: null })
    ).toMatchObject({ area: "MZANSI_BUSINESS", itemType: "Business" });
  });

  it("shows the taxonomy category when the legacy one is blank", () => {
    expect(promotionItem({ category: " ", category_key: "festival" }).category).toBe("festival");
    expect(promotionItem({ category: "Music", category_key: "festival" }).category).toBe("Music");
  });

  it("claims edit requests separately from the posts they change", () => {
    expect(claimTypeOf({ isEditRequest: true, contentType: "business" })).toBe("content_edit");
    expect(claimTypeOf({ contentType: "promotion" })).toBe("promotion");
    expect(claimTypeOf({})).toBe("listing");
  });
});
