import { describe, expect, it } from "vitest";
import { getContentEditChanges } from "./content-edit-diff";

describe("getContentEditChanges", () => {
  it("returns friendly changed fields from a submitted edit payload", () => {
    expect(
      getContentEditChanges(
        {
          title: "Used iPhone 15",
          description: "Original description",
          price_cents: 1200000,
          photos: ["one.jpg"],
          status: "live",
        },
        {
          title: "Used iPhone 15 Pro",
          description: "Updated description",
          price_cents: 1100000,
          photos: ["one.jpg", "two.jpg"],
          status: "live",
        }
      )
    ).toEqual([
      {
        field: "description",
        label: "Description",
        before: "Original description",
        after: "Updated description",
      },
      {
        field: "photos",
        label: "Photos",
        before: "1 photo",
        after: "2 photos",
      },
      {
        field: "price_cents",
        label: "Price",
        before: "R 12 000,00",
        after: "R 11 000,00",
      },
      {
        field: "title",
        label: "Title",
        before: "Used iPhone 15",
        after: "Used iPhone 15 Pro",
      },
    ]);
  });

  it("ignores workflow fields and unchanged nested data", () => {
    expect(
      getContentEditChanges(
        { attributes: { make: "Toyota", year: 2019 }, status: "live" },
        { attributes: { year: 2019, make: "Toyota" }, status: "pending_moderation" }
      )
    ).toEqual([]);
  });
});
