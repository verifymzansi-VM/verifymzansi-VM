import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_LISTING_PRICE_CENTS } from "./price";
import { parseListingPriceAmount, restoreListingPriceForm } from "./price-form";
import { formatZAR, formatZARShort, formatRandAmount } from "@/lib/utils/format";
import { randsToCents } from "@/lib/payments/ozow-refunds";

// Property tests for typed rand amounts and their display (see
// price-form.test.ts and format.test.ts for named examples).

const MAX_RANDS = Math.floor(MAX_LISTING_PRICE_CENTS / 100);
const cents = fc.integer({ min: 1, max: MAX_LISTING_PRICE_CENTS });
/** The amount text the form shows for stored cents ("1234.50"). */
const asText = (value: number) =>
  `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
/** Reads a formatted amount back ("R 12 345.60" to 1234560). */
const readBack = (text: string) => Math.round(Number(text.replace(/[^\d.-]/g, "")) * 100);

describe("parseListingPriceAmount", () => {
  it("reads back every amount the form shows, to the cent", () => {
    fc.assert(
      fc.property(cents, (value) => {
        expect(parseListingPriceAmount(asText(value))).toBe(value);
      })
    );
  });

  it("matches what the edit form restores from storage", () => {
    fc.assert(
      fc.property(cents, (value) => {
        const form = restoreListingPriceForm(
          { price_mode: "amount", price_cents: value, price_negotiable: false },
          "electronics"
        );
        expect(parseListingPriceAmount(form.amount)).toBe(value);
      })
    );
  });

  it("reads whole rands, one-decimal and two-decimal amounts, ignoring outer spaces", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_RANDS }),
        fc.integer({ min: 0, max: 99 }),
        fc.constantFrom("", " ", "\t"),
        (rands, fraction, pad) => {
          const value = rands * 100 + fraction;
          if (value < 1 || value > MAX_LISTING_PRICE_CENTS) return;
          const tenths = fraction % 10 === 0;
          if (fraction === 0) expect(parseListingPriceAmount(`${pad}${rands}${pad}`)).toBe(value);
          if (tenths) expect(parseListingPriceAmount(`${rands}.${fraction / 10}`)).toBe(value);
          expect(parseListingPriceAmount(`${rands}.${String(fraction).padStart(2, "0")}`)).toBe(
            value
          );
        }
      )
    );
  });

  it("always returns a whole number of cents within the allowed range, or refuses", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 16 }), (text) => {
        let result: number | undefined;
        try {
          result = parseListingPriceAmount(text);
        } catch {
          return;
        }
        expect(Number.isSafeInteger(result)).toBe(true);
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThanOrEqual(MAX_LISTING_PRICE_CENTS);
      }),
      { numRuns: 1000 }
    );
  });

  it("refuses signs, exponents, separators, a third decimal and nine-digit rands", () => {
    const digits = fc.stringMatching(/^[1-9][0-9]{0,6}$/);
    fc.assert(
      fc.property(digits, (text) => {
        for (const bad of [
          `-${text}`,
          `+${text}`,
          `${text}e2`,
          `${text},00`,
          `${text} 000`,
          `${text}.123`,
          `${text}.`,
          `.${text}`,
          `0x${text}`,
          `${text}${"0".repeat(9 - Math.min(text.length, 8))}`,
          `R${text}`,
        ])
          expect(() => parseListingPriceAmount(bad), bad).toThrow();
      })
    );
  });
});

describe("rand display", () => {
  it("formatZAR shows every whole number of cents exactly, grouped by thousands", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (value) => {
        const text = formatZAR(value);
        expect(text).toMatch(/^R -?\d{1,3}(?:\u00a0\d{3})*\.\d{2}$/);
        expect(readBack(text)).toBe(value);
      })
    );
  });

  it("formatZARShort drops the decimals only for whole rands", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), (value) => {
        const text = formatZARShort(value);
        expect(readBack(text)).toBe(value);
        expect(text.includes(".")).toBe(value % 100 !== 0);
      })
    );
  });

  it("formatRandAmount shows digits only, even for NaN or Infinity", () => {
    const amount = fc.oneof(
      fc.double({ min: -1e14, max: 1e14 }),
      fc.constantFrom(Number.NaN, Infinity, -Infinity)
    );
    fc.assert(
      fc.property(amount, fc.constantFrom(0 as const, 2 as const), (value, digits) => {
        expect(formatRandAmount(value, digits)).toMatch(/^-?\d{1,3}(?:\u00a0\d{3})*(?:\.\d{2})?$/);
      })
    );
  });
});

describe("randsToCents (Ozow refund amounts)", () => {
  it("reads every whole number of cents written as rands, as text or a number", () => {
    // Up to R10 million, far above any single payment.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e9 }), (value) => {
        expect(randsToCents((value / 100).toFixed(2))).toBe(value);
        expect(randsToCents(value / 100)).toBe(value);
      })
    );
  });

  it("refuses zero, negative, fractional-cent and non-numeric amounts", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e9 }), (value) => {
        expect(randsToCents(-value / 100)).toBeNull();
        expect(randsToCents((value + 0.5) / 100)).toBeNull();
      })
    );
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(null), fc.boolean(), fc.object(), fc.stringMatching(/^[a-z ]*$/)),
        (value) => {
          expect(randsToCents(value)).toBeNull();
        }
      )
    );
  });
});
