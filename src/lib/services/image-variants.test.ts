import { describe, it, expect } from "vitest";
import { variantKeyFor, parseVariantKey, VARIANT_WIDTHS } from "@/lib/services/image-variants";

describe("image-variants key helpers", () => {
  it("derives a variant key from an original key", () => {
    expect(variantKeyFor("media/listing/u/123-abc.jpg", 400)).toBe(
      "media/listing/u/123-abc.w400.webp"
    );
  });

  it("handles keys without an extension", () => {
    expect(variantKeyFor("media/listing/u/noext", 800)).toBe("media/listing/u/noext.w800.webp");
  });

  it("parses a variant key back to stem + width", () => {
    expect(parseVariantKey("media/listing/u/123-abc.w800.webp")).toEqual({
      originalKey: "media/listing/u/123-abc",
      width: 800,
    });
  });

  it("returns null for non-variant keys", () => {
    expect(parseVariantKey("media/listing/u/123-abc.jpg")).toBeNull();
    expect(parseVariantKey("media/listing/u/123-abc.webp")).toBeNull();
  });

  it("exposes the expected variant widths", () => {
    expect([...VARIANT_WIDTHS]).toEqual([400, 800, 1600]);
  });
});
