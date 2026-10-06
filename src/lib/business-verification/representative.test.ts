import { describe, expect, it } from "vitest";

import {
  codesMatch,
  hashCode,
  isRepresentativeConfirmed,
  isWorkEmail,
  newCode,
} from "./representative";

describe("representative route helpers", () => {
  it.each([
    ["thando@exampletrading.co.za", true],
    ["ops@example.com", true],
    ["thando@gmail.com", false],
    ["THANDO@Outlook.com", false],
    ["someone@telkomsa.net", false],
    ["no-at-sign", false],
  ])("treats %s as a work email: %s", (email, expected) => {
    expect(isWorkEmail(email)).toBe(expected);
  });

  it("issues 6-digit codes and checks them against the case they were sent for", () => {
    const code = newCode();
    expect(code).toMatch(/^\d{6}$/);
    const hash = hashCode("case-1", code);
    expect(codesMatch(hash, "case-1", code)).toBe(true);
    expect(codesMatch(hash, "case-2", code)).toBe(false);
    expect(codesMatch(hash, "case-1", code === "000000" ? "000001" : "000000")).toBe(false);
  });

  it("confirms only when email, domain and call-back are all done", () => {
    const callback = {
      numberSource: "Company website",
      spokeTo: "Reception",
      confirmedPosition: "Marketing Manager",
      confirmed: true,
      notes: null,
      by: "staff",
      at: "2026-10-06",
    };
    expect(
      isRepresentativeConfirmed({ emailVerifiedAt: "x", domainConfirmed: true, callback })
    ).toBe(true);
    expect(
      isRepresentativeConfirmed({ emailVerifiedAt: "x", domainConfirmed: false, callback })
    ).toBe(false);
    expect(isRepresentativeConfirmed({ domainConfirmed: true, callback })).toBe(false);
    expect(
      isRepresentativeConfirmed({
        emailVerifiedAt: "x",
        domainConfirmed: true,
        callback: { ...callback, confirmed: false },
      })
    ).toBe(false);
  });
});
