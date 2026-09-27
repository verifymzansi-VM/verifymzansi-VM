import { beforeEach, describe, expect, it, vi } from "vitest";

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock("@/lib/services/feature-flags", () => ({ isFeatureEnabled }));

import { evaluateStaffMfa, hasRecentSecondFactor, STAFF_MFA_FLAG } from "./staff-mfa";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const IN_GRACE = new Date("2026-10-01T00:00:00.000Z");
const GRACE_OVER = new Date("2026-09-20T00:00:00.000Z");

function supabaseWith(result: { data: unknown; error: unknown }) {
  return {
    auth: { mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue(result) } },
  } as never;
}

const aal = (currentLevel: string, nextLevel: string, methods: unknown[] = []) =>
  supabaseWith({
    data: { currentLevel, nextLevel, currentAuthenticationMethods: methods },
    error: null,
  });

describe("evaluateStaffMfa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockResolvedValue(true);
  });

  it("does nothing when the enforcement flag is off", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const supabase = aal("aal1", "aal1");
    await expect(evaluateStaffMfa(supabase, GRACE_OVER, NOW)).resolves.toEqual({
      status: "not_enforced",
    });
    expect(isFeatureEnabled).toHaveBeenCalledWith(STAFF_MFA_FLAG);
  });

  it("records when the second factor was last verified", async () => {
    const verifiedAt = minutesAgo(5);
    const state = await evaluateStaffMfa(
      aal("aal2", "aal2", [
        { method: "password", timestamp: seconds(minutesAgo(60)) },
        { method: "totp", timestamp: seconds(verifiedAt) },
      ]),
      GRACE_OVER,
      NOW
    );
    expect(state).toEqual({
      status: "verified",
      lastVerifiedAt: new Date(seconds(verifiedAt) * 1000),
    });
  });

  it("requires verification when a factor is enrolled, even during the grace period", async () => {
    await expect(evaluateStaffMfa(aal("aal1", "aal2"), IN_GRACE, NOW)).resolves.toEqual({
      status: "required",
      hasFactor: true,
    });
  });

  it("allows staff without a factor until the grace period ends", async () => {
    await expect(evaluateStaffMfa(aal("aal1", "aal1"), IN_GRACE, NOW)).resolves.toEqual({
      status: "grace",
      graceEndsAt: IN_GRACE,
    });
    await expect(evaluateStaffMfa(aal("aal1", "aal1"), GRACE_OVER, NOW)).resolves.toEqual({
      status: "required",
      hasFactor: false,
    });
  });

  it("never treats an unreadable session as verified", async () => {
    const broken = supabaseWith({ data: null, error: { message: "no session" } });
    await expect(evaluateStaffMfa(broken, IN_GRACE, NOW)).resolves.toMatchObject({
      status: "grace",
    });
    await expect(evaluateStaffMfa(broken, GRACE_OVER, NOW)).resolves.toMatchObject({
      status: "required",
    });
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

  it("does not block when enforcement is switched off", () => {
    expect(hasRecentSecondFactor({ status: "not_enforced" }, NOW)).toBe(true);
  });
});
