import { describe, expect, it } from "vitest";

import { publicPersonName, withPublicName } from "./public-name";

describe("publicPersonName", () => {
  it.each([
    ["Thando Dlamini", "Thando D."],
    ["  Thando   Sipho   Dlamini ", "Thando D."],
    ["thando dlamini", "thando D."],
    ["René du Plessis", "René P."],
    ["Thando", "Thando"],
    ["Thando D.", "Thando D."],
  ])("shows %s as %s", (input, expected) => {
    expect(publicPersonName(input)).toBe(expected);
  });

  it("returns null for empty names", () => {
    expect(publicPersonName("")).toBeNull();
    expect(publicPersonName(null)).toBeNull();
  });

  it("rewrites only the display name of a profile row", () => {
    expect(withPublicName({ display_name: "Thando Dlamini", user_id: "u1" })).toEqual({
      display_name: "Thando D.",
      user_id: "u1",
    });
    expect(withPublicName(null)).toBeNull();
  });
});
