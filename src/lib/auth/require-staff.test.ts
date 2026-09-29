import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AdminAccess from "./admin-access";
import type * as StaffMfa from "./staff-mfa";

const { getUser, readStaffAccessFromDb, evaluateStaffMfa, redirect } = vi.hoisted(() => ({
  getUser: vi.fn(),
  readStaffAccessFromDb: vi.fn(),
  evaluateStaffMfa: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/admin-access", async (importOriginal) => ({
  ...(await importOriginal<typeof AdminAccess>()),
  readStaffAccessFromDb,
}));
vi.mock("@/lib/auth/staff-mfa", async (importOriginal) => ({
  ...(await importOriginal<typeof StaffMfa>()),
  evaluateStaffMfa,
}));

import { requireStaff } from "./require-staff";

const GRACE = new Date("2026-10-01T00:00:00Z");

describe("requireStaff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({
      data: { user: { id: "user-1", app_metadata: { role: "admin" }, is_anonymous: false } },
    });
    readStaffAccessFromDb.mockResolvedValue({ role: "moderator", mfaRequiredAfter: GRACE });
    evaluateStaffMfa.mockResolvedValue({ status: "verified", lastVerifiedAt: new Date() });
  });

  it("sends signed-out visitors to sign in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireStaff()).rejects.toThrow("redirect:/login");
  });

  it("uses the database role, not the token, and sends non-staff to their dashboard", async () => {
    readStaffAccessFromDb.mockResolvedValue(null);
    await expect(requireStaff()).rejects.toThrow("redirect:/dashboard");
  });

  it("returns the database role for staff", async () => {
    await expect(requireStaff("queue:view")).resolves.toMatchObject({
      status: "staff",
      role: "moderator",
    });
  });

  it("sends staff without the capability back to the admin home", async () => {
    await expect(requireStaff("decision:approve")).rejects.toThrow("redirect:/admin");
  });

  it("sends staff who must verify to the two-step page", async () => {
    evaluateStaffMfa.mockResolvedValue({ status: "required", hasFactor: false });
    await expect(requireStaff("queue:view")).rejects.toThrow("redirect:/staff/two-step");
  });

  it("lets the two-step page itself render while verification is pending", async () => {
    evaluateStaffMfa.mockResolvedValue({ status: "required", hasFactor: false });
    await expect(requireStaff(undefined, { allowPendingMfa: true })).resolves.toMatchObject({
      mfa: { status: "required" },
    });
  });

  it("lets staff in during the grace period", async () => {
    evaluateStaffMfa.mockResolvedValue({ status: "grace", graceEndsAt: GRACE });
    await expect(requireStaff()).resolves.toMatchObject({ mfa: { status: "grace" } });
  });
});
