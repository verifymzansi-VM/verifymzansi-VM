import { describe, expect, it } from "vitest";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";

describe("isPlaceholderMarketplaceContent", () => {
  it("detects seed and demo markers", () => {
    expect(isPlaceholderMarketplaceContent("[Seed] Family Home", "Beautiful seed listing")).toBe(
      true
    );
    expect(isPlaceholderMarketplaceContent("Demo Plumbing Service")).toBe(true);
  });

  it("does not flag normal marketplace content", () => {
    expect(
      isPlaceholderMarketplaceContent(
        "Weekend Event MC Services",
        "Book a verified MC for weddings and community events."
      )
    ).toBe(false);
  });
});
