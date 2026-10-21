import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import rule from "./person-name-ranges.json";
import { isPersonName, isReservedPersonName, normalizePersonName } from "./person-name";

describe("person name rule", () => {
  it("accepts South African and international names", () => {
    for (const name of [
      "Thando D.",
      "Zoë",
      "ǃXóõ",
      "Nguyễn",
      "محمد",
      "सेनजो",
      "स्त",
      "王小明",
      "O'Brien",
      "Mary-Jane",
    ])
      expect(isPersonName(name)).toBe(true);
  });

  it("refuses spacing tricks, invisible and non-letter characters", () => {
    for (const name of [
      "A",
      "A".repeat(51),
      " Thando",
      "Thando ",
      "Thando  D",
      "Tab\tName",
      "Line\nBreak",
      "No\u00a0Break",
      "Zero\u200bWidth",
      "Right\u202eLeft",
      "Agent007",
      "Smile😀",
      "E\u0301rika",
    ])
      expect(isPersonName(name)).toBe(false);
    expect(isPersonName(null)).toBe(false);
  });

  it("normalizes browser input before the strict check", () => {
    expect(normalizePersonName("  E\u0301rika ")).toBe("Érika");
    expect(isPersonName(normalizePersonName("  E\u0301rika "))).toBe(true);
  });

  it("reserves platform and staff names with ASCII word boundaries", () => {
    for (const name of ["VerifyMzansi", "verify mzansi", "Site Admin", "OFFICIAL", "Staff-Member"])
      expect(isReservedPersonName(name)).toBe(true);
    for (const name of ["Adminah", "Supporter", "Thando"])
      expect(isReservedPersonName(name)).toBe(false);
  });

  it("matches the database rule generated from the same table", () => {
    const sql = readFileSync("docs/backend-foundation/prototypes/person-name-rule.sql", "utf8");
    expect(sql).toContain(`Unicode ${rule.unicode} letters and marks`);
    const escape = (code: number) =>
      code <= 0xffff
        ? "\\u" + code.toString(16).padStart(4, "0")
        : "\\U" + code.toString(16).padStart(8, "0");
    const [low, high] = rule.ranges[rule.ranges.length - 1];
    expect(sql).toContain(escape(low) + "-" + escape(high));
    expect(sql).toContain(
      "verify *mzansi|(^|[^a-z0-9_])(admin|administrator|moderator|support|staff|official)([^a-z0-9_]|$)"
    );
  });
});
