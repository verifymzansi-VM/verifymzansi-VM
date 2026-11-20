import fc from "fast-check";
import { describe, expect, it } from "vitest";
import rule from "./person-name-ranges.json";
import { isPersonName, isReservedPersonName, normalizePersonName } from "./person-name";

// Property tests for the person-name rule (see person-name.test.ts for named
// examples). The oracle below reads the same generated table with a plain
// linear search, so the binary search in person-name.ts is checked against it.

const ranges = rule.ranges as [number, number][];
const PUNCTUATION = [" ", "'", ".", "-"];
const inTable = (code: number) => ranges.some(([start, end]) => code >= start && code <= end);
const allowed = (character: string) =>
  PUNCTUATION.includes(character) || inTable(character.codePointAt(0) as number);

/** One code point from the table (a letter or mark). */
const letter = fc
  .integer({ min: 0, max: ranges.length - 1 })
  .chain((index) => fc.integer({ min: ranges[index][0], max: ranges[index][1] }))
  .map((code) => String.fromCodePoint(code));
/** A name part: NFC letters with single inner punctuation. */
const validName = fc
  .array(
    fc.tuple(fc.array(letter, { minLength: 1, maxLength: 8 }), fc.constantFrom("", ...PUNCTUATION)),
    { minLength: 1, maxLength: 6 }
  )
  .map((parts) =>
    parts
      .map(([letters, separator]) => letters.join("") + separator)
      .join("")
      .replace(/ +$/, "")
  )
  .filter((name) => {
    const length = Array.from(name).length;
    return name.normalize("NFC") === name && length >= 2 && length <= 50 && !/^ | {2}/.test(name);
  });
/** Characters outside the rule: digits, symbols, controls, other spaces, emoji. */
const outsider = fc.constantFrom(
  "0",
  "7",
  "@",
  "_",
  "!",
  "/",
  "<",
  "\t",
  "\n",
  ...[0x0000, 0x00a0, 0x200b, 0x202e, 0x1f600, 0x2019].map((code) => String.fromCodePoint(code))
);

describe("isPersonName", () => {
  it("the table is sorted and its ranges do not overlap (the binary search relies on it)", () => {
    for (let index = 0; index < ranges.length; index += 1) {
      const [start, end] = ranges[index];
      expect(start).toBeLessThanOrEqual(end);
      if (index > 0) expect(start).toBeGreaterThan(ranges[index - 1][1]);
    }
  });

  it("agrees with a plain reading of the rule for any string", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 60 }), (value) => {
        const characters = Array.from(value);
        const expected =
          value.normalize("NFC") === value &&
          characters.length >= 2 &&
          characters.length <= 50 &&
          !/^ | $| {2}/.test(value) &&
          characters.every(allowed);
        expect(isPersonName(value)).toBe(expected);
      }),
      { numRuns: 500 }
    );
  });

  it("agrees with the table for any single code point", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0x10ffff }), (code) => {
        if (code >= 0xd800 && code <= 0xdfff) return;
        const character = String.fromCodePoint(code);
        const name = character + character;
        if (name.normalize("NFC") !== name) return;
        expect(isPersonName(name)).toBe(allowed(character));
      }),
      { numRuns: 2000 }
    );
  });

  it("accepts every well-formed name", () => {
    fc.assert(
      fc.property(validName, (name) => {
        expect(isPersonName(name)).toBe(true);
      })
    );
  });

  it("refuses a well-formed name with one character from outside the rule", () => {
    fc.assert(
      fc.property(validName, outsider, fc.nat(), (name, bad, at) => {
        const characters = Array.from(name);
        characters.splice(at % (characters.length + 1), 0, bad);
        expect(isPersonName(characters.join(""))).toBe(false);
      })
    );
  });

  it("refuses names with a space at either end or two spaces together", () => {
    fc.assert(
      fc.property(validName, (name) => {
        expect(isPersonName(` ${name}`)).toBe(false);
        expect(isPersonName(`${name} `)).toBe(false);
        const short = Array.from(name).slice(0, 20).join("").trimEnd();
        expect(isPersonName(`${short}  ${short}`)).toBe(false);
      })
    );
  });

  it("counts code points, not UTF-16 units, for the length limits", () => {
    const astral = ranges.find(([start]) => start > 0xffff);
    if (!astral) return;
    const character = String.fromCodePoint(astral[0]);
    expect(isPersonName(character.repeat(50))).toBe(true);
    expect(isPersonName(character.repeat(51))).toBe(false);
    expect(isPersonName(character)).toBe(false);
  });

  it("refuses anything that is not a string", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.object(), fc.array(fc.string())),
        (value) => {
          expect(isPersonName(value)).toBe(false);
        }
      )
    );
  });
});

describe("normalizePersonName", () => {
  it("is idempotent and its result is NFC without outer whitespace", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 40 }), (value) => {
        const once = normalizePersonName(value);
        expect(normalizePersonName(once)).toBe(once);
        expect(once.normalize("NFC")).toBe(once);
        expect(once).toBe(once.trim());
      })
    );
  });

  it("turns a decomposed well-formed name back into an accepted one", () => {
    fc.assert(
      fc.property(validName, (name) => {
        expect(isPersonName(normalizePersonName(`  ${name.normalize("NFD")}\n`))).toBe(true);
      })
    );
  });
});

describe("isReservedPersonName", () => {
  const word = fc.constantFrom(
    "admin",
    "administrator",
    "moderator",
    "support",
    "staff",
    "official"
  );
  const around = fc.constantFrom("", " ", "-", ".", "'");

  it("ignores ASCII letter case", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (value) => {
        const upper = value.replace(/[a-z]/g, (letter) => letter.toUpperCase());
        expect(isReservedPersonName(upper)).toBe(isReservedPersonName(value));
      })
    );
  });

  it("reserves a staff word standing on its own anywhere in a name", () => {
    fc.assert(
      fc.property(validName, word, around, fc.boolean(), (name, reserved, separator, first) => {
        const value = first
          ? `${reserved}${separator || " "}${name}`
          : `${name}${separator || " "}${reserved}`;
        expect(isReservedPersonName(fc.sample(fc.mixedCase(fc.constant(value)), 1)[0])).toBe(true);
      })
    );
  });

  it("reserves the platform's name with any number of spaces", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), validName, (spaces, name) => {
        expect(isReservedPersonName(`${name} Verify${" ".repeat(spaces)}Mzansi`)).toBe(true);
      })
    );
  });

  it("does not reserve a staff word inside a longer word", () => {
    fc.assert(
      fc.property(word, fc.stringMatching(/^[a-z0-9_]{1,5}$/), (reserved, glue) => {
        expect(isReservedPersonName(`${glue}${reserved}${glue}`)).toBe(false);
      })
    );
  });
});
