import { describe, expect, it } from "vitest";
import { formatFreeCreditDate, freeCreditReasonValid, postsLabel } from "./free-credits";

describe("free credits screen helpers", () => {
  it("formats dates in South African time", () => {
    expect(formatFreeCreditDate("2026-12-22T08:00:00Z")).toBe("22 Dec 2026");
    // 23:30 UTC is already the next day in Johannesburg.
    expect(formatFreeCreditDate("2026-12-21T23:30:00Z")).toBe("22 Dec 2026");
    expect(formatFreeCreditDate("not a date")).toBe("");
  });

  it("counts posts", () => {
    expect(postsLabel(1)).toBe("1 post");
    expect(postsLabel(6)).toBe("6 posts");
  });

  it("accepts a reason of 5 to 200 characters on one line", () => {
    expect(freeCreditReasonValid("five!")).toBe(true);
    expect(freeCreditReasonValid("  five!  ")).toBe(true);
    expect(freeCreditReasonValid("a".repeat(200))).toBe(true);
    expect(freeCreditReasonValid("abcd")).toBe(false);
    expect(freeCreditReasonValid("a".repeat(201))).toBe(false);
    expect(freeCreditReasonValid("two\nlines")).toBe(false);
  });
});
