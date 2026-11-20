import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { slugify } from "./utils";

// Property tests for slugify (see utils.test.ts for named examples).

describe("slugify", () => {
  const anything = fc.string({ unit: "binary", maxLength: 60 });

  it("returns only lower-case letters, digits and hyphens, never at either end", () => {
    fc.assert(
      fc.property(anything, (text) => {
        const slug = slugify(text);
        expect(slug).toMatch(/^[a-z0-9-]*$/);
        expect(slug).not.toMatch(/^-|-$/);
      }),
      { numRuns: 1000 }
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(anything, (text) => {
        expect(slugify(slugify(text))).toBe(slugify(text));
      }),
      { numRuns: 1000 }
    );
  });

  it("ignores letter case and accents on Latin letters", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9 ]{1,30}$/), (text) => {
        expect(slugify(text.toUpperCase())).toBe(slugify(text));
        expect(slugify(text.replace(/e/g, "é").replace(/a/g, "À"))).toBe(slugify(text));
      })
    );
  });

  it("keeps the words of plain text, joined by hyphens", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { minLength: 1, maxLength: 6 }),
        (words) => {
          expect(slugify(words.join("  "))).toBe(words.join("-"));
          expect(slugify(words.join("_"))).toBe(words.join("-"));
        }
      )
    );
  });
});
