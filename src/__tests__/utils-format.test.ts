import { describe, it, expect } from "vitest";
import { formatZAR, formatZARShort } from "@/lib/utils/format";
import { slugify, truncate, cn } from "@/lib/utils";

describe("formatZAR", () => {
  it("should format cents to ZAR", () => {
    // en-ZA locale may use comma or dot as decimal separator depending on environment
    expect(formatZAR(26000)).toMatch(/^R 260[.,]00$/);
    expect(formatZAR(100)).toMatch(/^R 1[.,]00$/);
    expect(formatZAR(0)).toMatch(/^R 0[.,]00$/);
    expect(formatZAR(9999)).toMatch(/^R 99[.,]99$/);
  });

  it("should handle NaN gracefully", () => {
    expect(formatZAR(NaN)).toMatch(/^R 0[.,]00$/);
  });

  it("should handle Infinity gracefully", () => {
    expect(formatZAR(Infinity)).toMatch(/^R 0[.,]00$/);
    expect(formatZAR(-Infinity)).toMatch(/^R 0[.,]00$/);
  });
});

describe("formatZARShort", () => {
  it("should format round amounts without decimals", () => {
    expect(formatZARShort(26000)).toMatch(/R\s*260/);
  });

  it("should format non-round amounts with decimals", () => {
    expect(formatZARShort(2650)).toMatch(/R\s*26[.,]50/);
  });
});

describe("slugify", () => {
  it("should convert to URL-safe slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("Product 123!")).toBe("product-123");
    expect(slugify("  Multiple   Spaces  ")).toBe("multiple-spaces");
  });

  it("should handle empty/null-like input", () => {
    expect(slugify("")).toBe("");
  });
});

describe("truncate", () => {
  it("should truncate long text", () => {
    expect(truncate("Hello World", 5)).toBe("Hello…");
  });

  it("should not truncate short text", () => {
    expect(truncate("Hi", 10)).toBe("Hi");
  });
});

describe("cn", () => {
  it("should merge class names", () => {
    const result = cn("px-4", "py-2", "px-6");
    expect(result).toContain("px-6");
    expect(result).toContain("py-2");
    expect(result).not.toContain("px-4");
  });
});
