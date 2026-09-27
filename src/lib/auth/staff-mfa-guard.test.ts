import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as StaffMfa from "./staff-mfa";

// src/test/setup.ts replaces this module globally; test the real one here.
vi.unmock("@/lib/auth/staff-mfa-guard");

const { readStaffAccessFromDb, evaluateStaffMfa } = vi.hoisted(() => ({
  readStaffAccessFromDb: vi.fn(),
  evaluateStaffMfa: vi.fn(),
}));
vi.mock("@/lib/auth/admin-access", () => ({ readStaffAccessFromDb }));
vi.mock("@/lib/auth/staff-mfa", async (importOriginal) => ({
  ...(await importOriginal<typeof StaffMfa>()),
  evaluateStaffMfa,
}));

import { checkStaffApiMfa } from "./staff-mfa-guard";

const supabase = {} as never;
const recently = () => new Date(Date.now() - 60_000);

describe("checkStaffApiMfa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readStaffAccessFromDb.mockResolvedValue({
      role: "admin",
      mfaRequiredAfter: new Date("2026-10-01T00:00:00Z"),
    });
  });

  it("refuses anyone the database no longer lists as staff", async () => {
    readStaffAccessFromDb.mockResolvedValue(null);
    const res = await checkStaffApiMfa(supabase, "user-1");
    expect(res?.status).toBe(403);
    expect(evaluateStaffMfa).not.toHaveBeenCalled();
  });

  it("blocks staff who must verify, pointing them to the two-step page", async () => {
    evaluateStaffMfa.mockResolvedValue({ status: "required", hasFactor: true });
    const res = await checkStaffApiMfa(supabase, "user-1");
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toMatchObject({
      code: "mfa_required",
      verifyUrl: "/staff/two-step",
    });
  });

  it("lets routine actions through during the grace period", async () => {
    evaluateStaffMfa.mockResolvedValue({ status: "grace", graceEndsAt: new Date() });
    await expect(checkStaffApiMfa(supabase, "user-1")).resolves.toBeNull();
  });

  it("asks for a fresh code on sensitive actions during the grace period", async () => {
    evaluateStaffMfa.mockResolvedValue({ status: "grace", graceEndsAt: new Date() });
    const res = await checkStaffApiMfa(supabase, "user-1", { stepUp: true });
    await expect(res?.json()).resolves.toMatchObject({ code: "step_up_required" });
  });

  it("allows sensitive actions right after verifying", async () => {
    evaluateStaffMfa.mockResolvedValue({ status: "verified", lastVerifiedAt: recently() });
    await expect(checkStaffApiMfa(supabase, "user-1", { stepUp: true })).resolves.toBeNull();
  });
});
