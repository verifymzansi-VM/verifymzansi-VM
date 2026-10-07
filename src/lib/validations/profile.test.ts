import { describe, expect, it } from "vitest";

import { isReservedDisplayName, profileUpdateSchema } from "./profile";

const nameOk = (displayName: string) => profileUpdateSchema.safeParse({ displayName }).success;

describe("profile display name", () => {
  it.each(["Thando Dlamini", "René du Plessis", "Thando D.", "N'wa-Mkhize"])("accepts %s", (n) =>
    expect(nameOk(n)).toBe(true)
  );

  it("rejects digits and symbols", () => {
    expect(nameOk("Call 0821234567")).toBe(false);
    expect(nameOk("Thando <b>")).toBe(false);
  });

  it.each(["VerifyMzansi Support", "Verify Mzansi", "Site Admin", "Moderator Jo"])(
    "flags %s as a platform name",
    (n) => expect(isReservedDisplayName(n)).toBe(true)
  );

  it("doesn't flag ordinary names containing those letters", () => {
    expect(isReservedDisplayName("Supporta Staffordson")).toBe(false);
  });

  it("rejects hidden direction characters", () => {
    expect(nameOk(`Thando${String.fromCharCode(0x202e)} Dlamini`)).toBe(false);
  });
});
