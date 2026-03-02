import { describe, expect, it } from "vitest";
import { cn, slugify, truncate, generateId } from "../utils";

describe("cn", () => {
  it("merges Tailwind classes", () => {
    const result = cn("px-2 py-1", "px-4");
    expect(result).toContain("py-1");
    expect(result).toContain("px-4");
    expect(result).not.toContain("px-2");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "extra")).toBe("base extra");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });
});

describe("slugify", () => {
  it("converts text to URL-safe slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Test! @#$ Slug")).toBe("test-slug");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("--test--")).toBe("test");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

describe("truncate", () => {
  it("returns original text if within limit", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("truncates with ellipsis", () => {
    const result = truncate("This is a very long string", 10);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(11);
    expect(result.length).toBeGreaterThan(1);
  });

  it("handles exact length", () => {
    expect(truncate("exact", 5)).toBe("exact");
  });
});

describe("generateId", () => {
  it("returns a valid UUID", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique values", () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateId()));
    expect(ids.size).toBe(10);
  });
});
