import { describe, expect, it } from "vitest";
import { countsOrThrow } from "./counts";

describe("countsOrThrow", () => {
  it("returns every count when all reads succeed", () => {
    const [a, b] = countsOrThrow(
      [
        { count: 4, error: null },
        { count: null, error: null },
      ],
      "Users"
    );
    expect([a.count, b.count]).toEqual([4, 0]);
  });

  it("throws rather than letting a failed read show as zero", () => {
    expect(() =>
      countsOrThrow(
        [
          { count: 4, error: null },
          { count: null, error: { message: "timeout" } },
        ],
        "User figures"
      )
    ).toThrow("User figures could not be counted: timeout");
  });
});
