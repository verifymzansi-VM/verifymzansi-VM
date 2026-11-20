import { describe, expect, it } from "vitest";
import { evaluateStaffMfa, hasRecentSecondFactor } from "./staff-mfa";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const IN_GRACE = new Date("2026-10-01T00:00:00.000Z");

const facts = (overrides: Partial<Parameters<typeof evaluateStaffMfa>[0]> = {}) => ({
  canAccess: true,
  totpEnrolled: true,
  authenticatorAt: seconds(minutesAgo(5)),
  ...overrides,
});

describe("evaluateStaffMfa", () => {
  it("records when the second factor was last verified", () => {
    expect(evaluateStaffMfa(facts(), NOW)).toEqual({
      status: "verified",
      lastVerifiedAt: new Date(seconds(minutesAgo(5)) * 1000),
    });
  });

  it("accepts a code verified exactly 12 hours ago", () => {
    expect(
      evaluateStaffMfa(facts({ authenticatorAt: seconds(minutesAgo(12 * 60)) }), NOW)
    ).toMatchObject({ status: "verified" });
  });

  it("asks staff to verify again once the last authenticator code is over 12 hours old", () => {
    // The database's own check would refuse this too; the app does not rely on it.
    expect(
      evaluateStaffMfa(facts({ authenticatorAt: seconds(minutesAgo(12 * 60 + 1)) }), NOW)
    ).toEqual({ status: "required", hasFactor: true });
  });

  it("follows the database when it refuses the session", () => {
    // No code in this session, expired code, or a role assigned after the last code.
    expect(evaluateStaffMfa(facts({ canAccess: false }), NOW)).toEqual({
      status: "required",
      hasFactor: true,
    });
  });

  it("sends staff without an authenticator app to enrol, with no grace period", () => {
    expect(
      evaluateStaffMfa(facts({ canAccess: false, totpEnrolled: false, authenticatorAt: null }), NOW)
    ).toEqual({ status: "required", hasFactor: false });
  });

  it.each([null, 0, -5, 1.5, Number.NaN])(
    "never treats a session without a valid authenticator time as verified: %s",
    (authenticatorAt) => {
      expect(evaluateStaffMfa(facts({ authenticatorAt }), NOW)).toEqual({
        status: "required",
        hasFactor: true,
      });
    }
  );

  it("never returns the disabled or grace states", () => {
    for (const canAccess of [true, false])
      for (const totpEnrolled of [true, false])
        for (const authenticatorAt of [null, seconds(minutesAgo(1)), seconds(minutesAgo(9999))])
          expect(["verified", "required"]).toContain(
            evaluateStaffMfa({ canAccess, totpEnrolled, authenticatorAt }, NOW).status
          );
  });
});

describe("hasRecentSecondFactor", () => {
  it("accepts a factor verified within 15 minutes", () => {
    expect(hasRecentSecondFactor({ status: "verified", lastVerifiedAt: minutesAgo(14) }, NOW)).toBe(
      true
    );
  });

  it("rejects an older factor, a missing timestamp, and the grace period", () => {
    expect(hasRecentSecondFactor({ status: "verified", lastVerifiedAt: minutesAgo(16) }, NOW)).toBe(
      false
    );
    expect(hasRecentSecondFactor({ status: "verified", lastVerifiedAt: null }, NOW)).toBe(false);
    expect(hasRecentSecondFactor({ status: "grace", graceEndsAt: IN_GRACE }, NOW)).toBe(false);
    expect(hasRecentSecondFactor({ status: "required", hasFactor: true }, NOW)).toBe(false);
  });

  it("requires a verified factor even when enforcement is switched off", () => {
    expect(hasRecentSecondFactor({ status: "not_enforced" }, NOW)).toBe(false);
  });
  it.each([new Date(NOW.getTime() + 1000), new Date(NaN)])(
    "rejects future or invalid timestamps: %s",
    (lastVerifiedAt) => {
      expect(hasRecentSecondFactor({ status: "verified", lastVerifiedAt }, NOW)).toBe(false);
    }
  );
  it("accepts the exact step-up deadline", () => {
    expect(hasRecentSecondFactor({ status: "verified", lastVerifiedAt: minutesAgo(15) }, NOW)).toBe(
      true
    );
  });

  it("applies the 15-minute window to a freshly evaluated session", () => {
    const fresh = evaluateStaffMfa(facts({ authenticatorAt: seconds(minutesAgo(14)) }), NOW);
    const stale = evaluateStaffMfa(facts({ authenticatorAt: seconds(minutesAgo(16)) }), NOW);
    expect(hasRecentSecondFactor(fresh, NOW)).toBe(true);
    expect(hasRecentSecondFactor(stale, NOW)).toBe(false);
  });
});
