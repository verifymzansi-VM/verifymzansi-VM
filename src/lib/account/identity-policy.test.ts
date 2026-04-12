import { describe, expect, it, vi } from "vitest";
import {
  EMAIL_CHANGE_COOLDOWN_DAYS,
  EMAIL_CHANGE_COOLDOWN_MS,
  PHONE_CHANGE_COOLDOWN_DAYS,
  PHONE_CHANGE_COOLDOWN_MS,
  checkCooldown,
  emailCooldown,
  locationLocked,
  nameLocked,
  phoneCooldown,
  phoneReverificationRequired,
} from "@/lib/account/identity-policy";

describe("identity-policy", () => {
  it("defines 15-day cooldown constants", () => {
    expect(PHONE_CHANGE_COOLDOWN_DAYS).toBe(15);
    expect(EMAIL_CHANGE_COOLDOWN_DAYS).toBe(15);
    expect(PHONE_CHANGE_COOLDOWN_MS).toBe(15 * 24 * 60 * 60 * 1000);
    expect(EMAIL_CHANGE_COOLDOWN_MS).toBe(15 * 24 * 60 * 60 * 1000);
  });

  it("creates stable locked-field policy errors", () => {
    expect(nameLocked()).toMatchObject({ code: "NAME_LOCKED" });
    expect(locationLocked()).toEqual({
      code: "LOCATION_LOCKED",
      message: "Your province and city were set during verification and cannot be changed.",
    });
  });

  it("creates phone and email cooldown errors with retryAfter", () => {
    const nextEligibleAt = new Date("2026-04-30T10:00:00.000Z");

    const phone = phoneCooldown(nextEligibleAt);
    const email = emailCooldown(nextEligibleAt);

    expect(phone.code).toBe("PHONE_COOLDOWN");
    expect(phone.retryAfter).toBe(nextEligibleAt.toISOString());
    expect(phone.message).toContain("30 April 2026");

    expect(email.code).toBe("EMAIL_COOLDOWN");
    expect(email.retryAfter).toBe(nextEligibleAt.toISOString());
    expect(email.message).toContain("30 April 2026");
  });

  it("creates phone re-verification required error", () => {
    expect(phoneReverificationRequired()).toEqual({
      code: "PHONE_REVERIFICATION_REQUIRED",
      message: "You must complete identity re-verification before changing your phone number.",
    });
  });

  it("checkCooldown returns null when lastChange is missing or invalid", () => {
    expect(checkCooldown(null, PHONE_CHANGE_COOLDOWN_MS)).toBeNull();
    expect(checkCooldown(undefined, PHONE_CHANGE_COOLDOWN_MS)).toBeNull();
    expect(checkCooldown("not-a-date", PHONE_CHANGE_COOLDOWN_MS)).toBeNull();
  });

  it("checkCooldown returns future eligibility date when still in cooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T10:00:00.000Z"));

    const lastChangeIso = "2026-04-10T10:00:00.000Z";
    const eligible = checkCooldown(lastChangeIso, 7 * 24 * 60 * 60 * 1000);

    expect(eligible?.toISOString()).toBe("2026-04-17T10:00:00.000Z");

    vi.useRealTimers();
  });

  it("checkCooldown returns null after cooldown elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T10:00:00.000Z"));

    const lastChangeIso = "2026-04-10T10:00:00.000Z";
    expect(checkCooldown(lastChangeIso, 7 * 24 * 60 * 60 * 1000)).toBeNull();

    vi.useRealTimers();
  });
});
