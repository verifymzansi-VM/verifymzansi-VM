import { describe, it, expect } from "vitest";
import { isPlaceholderMarketplaceContent } from "./placeholder-content";

describe("isPlaceholderMarketplaceContent", () => {
  it("detects [seed] marker", () => {
    expect(isPlaceholderMarketplaceContent("[seed] Test item")).toBe(true);
  });

  it("detects [demo] marker case-insensitively", () => {
    expect(isPlaceholderMarketplaceContent("[Demo] Something")).toBe(true);
  });

  it("detects word boundary placeholder", () => {
    expect(isPlaceholderMarketplaceContent("This is a sample entry")).toBe(true);
  });

  it("detects sandbox keyword", () => {
    expect(isPlaceholderMarketplaceContent("sandbox test data")).toBe(true);
  });

  it("returns false for real content", () => {
    expect(isPlaceholderMarketplaceContent("Brand new iPhone 15")).toBe(false);
  });

  it("returns false for null/undefined fields", () => {
    expect(isPlaceholderMarketplaceContent(null, undefined)).toBe(false);
  });

  it("returns true if any field matches", () => {
    expect(isPlaceholderMarketplaceContent("real title", "[placeholder] desc")).toBe(true);
  });

  it("returns false for all empty fields", () => {
    expect(isPlaceholderMarketplaceContent("", "")).toBe(false);
  });
});
