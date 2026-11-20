import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffAccess } from "./admin-access";

// src/test/setup.ts replaces this module globally; test the real one here.
vi.unmock("@/lib/auth/staff-mfa-guard");

const { recordSecurityEvent } = vi.hoisted(() => ({ recordSecurityEvent: vi.fn() }));
vi.mock("@/lib/security/security-events", () => ({ recordSecurityEvent }));

import { checkStaffApiMfa } from "./staff-mfa-guard";

const accountId = "11111111-1111-4111-8111-111111111111";
const minutesAgo = (m: number) => Math.floor(Date.now() / 1000) - m * 60;
const access = (overrides: Partial<StaffAccess> = {}): StaffAccess => ({
  role: "admin",
  capabilities: ["queue:view"],
  canAccess: true,
  totpEnrolled: true,
  ...overrides,
});
const check = (
  input: { access?: StaffAccess | null; authenticatorAt?: number | null } = {},
  options?: { stepUp?: boolean }
) =>
  checkStaffApiMfa(
    {
      access: input.access === undefined ? access() : input.access,
      accountId,
      authenticatorAt: input.authenticatorAt === undefined ? minutesAgo(1) : input.authenticatorAt,
    },
    options
  );

describe("checkStaffApiMfa", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses anyone the database no longer lists as staff", async () => {
    const res = await check({ access: null });
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("lets a session verified within 12 hours through", async () => {
    await expect(check({ authenticatorAt: minutesAgo(11 * 60) })).resolves.toBeNull();
  });

  it.each([
    ["the database refuses the session", { access: access({ canAccess: false }) }],
    ["the last code is over 12 hours old", { authenticatorAt: minutesAgo(12 * 60 + 1) }],
    ["the session never used its authenticator", { authenticatorAt: null }],
  ])("blocks staff who must verify (%s), pointing them to the two-step page", async (_, input) => {
    const res = await check(input);
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toMatchObject({
      code: "mfa_required",
      verifyUrl: "/staff/two-step",
    });
    expect(recordSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, reason: "mfa_required" })
    );
  });

  it("sends staff without an authenticator app to enrol (no grace period)", async () => {
    const res = await check({
      access: access({ canAccess: false, totpEnrolled: false }),
      authenticatorAt: null,
    });
    await expect(res?.json()).resolves.toMatchObject({ code: "mfa_required" });
  });

  it("allows sensitive actions right after verifying", async () => {
    await expect(check({ authenticatorAt: minutesAgo(1) }, { stepUp: true })).resolves.toBeNull();
  });

  it("asks for a fresh code on sensitive actions after 15 minutes", async () => {
    const res = await check({ authenticatorAt: minutesAgo(16) }, { stepUp: true });
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toMatchObject({
      code: "step_up_required",
      verifyUrl: "/staff/two-step?confirm=1",
    });
    expect(recordSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, reason: "step_up_required" })
    );
  });

  it("does not ask for a fresh code on routine actions within 12 hours", async () => {
    await expect(check({ authenticatorAt: minutesAgo(16) })).resolves.toBeNull();
  });
});
