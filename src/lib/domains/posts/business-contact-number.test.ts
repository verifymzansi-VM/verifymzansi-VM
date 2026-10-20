/** @vitest-environment node */
import { expect, it } from "vitest";
import {
  parseSaBusinessContactNumber,
  saBusinessContactNumberInputSchema,
} from "./business-contact-number";

it("canonicalises ordinary business landline and mobile formats without a mobile-only assumption", () => {
  for (const [input, expected] of [
    ["011 234 5678", "+27112345678"],
    ["(011) 234-5678", "+27112345678"],
    [" +27 (11) 234-5678 ", "+27112345678"],
    ["+27 (0)11 234 5678", "+27112345678"],
    ["0027 (0)11 234 5678", "+27112345678"],
    ["0027112345678", "+27112345678"],
    ["071 234 5678", "+27712345678"],
    ["+27712345678", "+27712345678"],
  ])
    expect(parseSaBusinessContactNumber(input)).toBe(expected);
});

it("rejects short codes, machine-length numbers, other countries, extensions and malformed syntax", () => {
  for (const input of [
    "",
    " ",
    "112",
    "0000000000",
    "07123456789012",
    "+447123456789",
    "+270112345678",
    "00270112345678",
    "0112345678 ext 1",
    "0112345678#1",
    "0112345678;123",
    "tel:+27112345678",
    "0+27112345678",
    "++27112345678",
    "(0112345678",
    "011)2345678",
    "((011))2345678",
    " ".repeat(65) + "0112345678",
    "０１１２３４５６７８",
    "\u202e0112345678",
    "011\u200b2345678",
    "0112345678\n",
    "\u00a00112345678",
    "\ufeff0112345678",
  ])
    expect(saBusinessContactNumberInputSchema.safeParse(input).success).toBe(false);
});

it("rejects non-string inputs with a fixed error rather than coerced numbers or authority objects", () => {
  for (const input of [
    undefined,
    null,
    112345678,
    [],
    {},
    { phone: "0112345678" },
    { verified: true },
  ])
    expect(() => parseSaBusinessContactNumber(input)).toThrow(
      /^Invalid South African business contact number$/
    );
});

it("round-trips canonical values without adding a proof or a capability claim", () => {
  for (const input of ["011 234 5678", "071 234 5678", "0800 123 456"]) {
    const result = parseSaBusinessContactNumber(input);
    expect(result).toMatch(/^\+27[1-9][0-9]{8}$/);
    expect(parseSaBusinessContactNumber(result)).toBe(result);
    expect(typeof result).toBe("string");
  }
});
