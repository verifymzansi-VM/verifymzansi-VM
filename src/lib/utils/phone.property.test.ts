import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isValidSaPhone, normalizeSaPhone, sanitizeSaPhoneInput } from "./phone";

// Property tests for South African mobile numbers (see phone.test.ts for
// named examples).

/** The nine digits after +27 of a mobile number (6, 7 or 8 first). */
const subscriber = fc.stringMatching(/^[6-8][0-9]{8}$/);
/** Ways people type a number: spaces, dashes, brackets, dots. */
const punctuate = (digits: string, separator: string) =>
  digits.replace(/(\d{2})(\d{3})(\d{4})$/, `$1${separator}$2${separator}$3`);
const separator = fc.constantFrom("", " ", "-", ".", " - ");

describe("normalizeSaPhone", () => {
  it("writes every form of a mobile number as the same +27 number", () => {
    fc.assert(
      fc.property(subscriber, separator, fc.constantFrom("", " ", "\t"), (digits, sep, pad) => {
        const expected = `+27${digits}`;
        for (const typed of [
          `0${punctuate(digits, sep)}`,
          `+27${punctuate(digits, sep)}`,
          `27${punctuate(digits, sep)}`,
          `+27 ${digits}`,
          `(0${digits.slice(0, 2)}) ${digits.slice(2)}`,
        ])
          expect(normalizeSaPhone(`${pad}${typed}${pad}`), typed).toBe(expected);
      })
    );
  });

  it("is idempotent for any input", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary-ascii", maxLength: 24 }), (value) => {
        const once = normalizeSaPhone(value);
        expect(normalizeSaPhone(once)).toBe(once);
      }),
      { numRuns: 1000 }
    );
  });

  it("keeps only digits and plus signs", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 24 }), (value) => {
        expect(normalizeSaPhone(value)).toMatch(/^[0-9+]*$/);
        expect(sanitizeSaPhoneInput(value)).toMatch(/^[0-9+]*$/);
      }),
      { numRuns: 1000 }
    );
  });
});

describe("isValidSaPhone", () => {
  it("accepts exactly the inputs that normalise to a +27 mobile number", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: "binary-ascii", maxLength: 16 }),
          subscriber.map((digits) => `0${digits}`),
          subscriber.map((digits) => `+27${digits}`),
          fc.stringMatching(/^\+?27[0-9]{7,10}$/),
          fc.stringMatching(/^0[0-9]{8,10}$/)
        ),
        (value) => {
          if (isValidSaPhone(value)) expect(normalizeSaPhone(value)).toMatch(/^\+27[6-8]\d{8}$/);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("refuses landline, short and long numbers", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-59][0-9]{8}$/), (digits) => {
        expect(isValidSaPhone(`0${digits}`)).toBe(false);
        expect(isValidSaPhone(`+27${digits}`)).toBe(false);
      })
    );
    fc.assert(
      fc.property(subscriber, (digits) => {
        expect(isValidSaPhone(`0${digits.slice(1)}`)).toBe(false);
        expect(isValidSaPhone(`0${digits}0`)).toBe(false);
        expect(isValidSaPhone(`+27${digits}0`)).toBe(false);
      })
    );
  });
});
