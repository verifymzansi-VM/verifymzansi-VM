import { describe, expect, it } from "vitest";
import { getBusinessVenuePhotoUrls } from "./venue-photos";

describe("getBusinessVenuePhotoUrls", () => {
  it("reads current venue photos from category_details", () => {
    expect(getBusinessVenuePhotoUrls(null, { venue_photos: ["https://a/1.jpg"] })).toEqual([
      "https://a/1.jpg",
    ]);
  });

  it("falls back to legacy mall-store photos and removes duplicates", () => {
    expect(
      getBusinessVenuePhotoUrls(
        { type: "mall_store", mall_photos: ["https://a/1.jpg", "https://a/2.jpg"] },
        { venue_photos: ["https://a/1.jpg"] }
      )
    ).toEqual(["https://a/1.jpg", "https://a/2.jpg"]);
  });

  it("ignores other business types and junk values", () => {
    expect(
      getBusinessVenuePhotoUrls(
        { type: "standalone_shop", mall_photos: ["https://a/1.jpg"] },
        { venue_photos: [null, "", 3] }
      )
    ).toEqual([]);
  });
});
