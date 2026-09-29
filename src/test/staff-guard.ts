import { vi } from "vitest";
import { redirect } from "next/navigation";
import type { StaffRole } from "@/types/enums";

/**
 * Test double for `@/lib/auth/require-staff`. Use it in a page test with:
 *
 *   vi.mock("@/lib/auth/require-staff", async () => (await import("@/test/staff-guard")).staffGuardModule);
 *   import { staffGuard } from "@/test/staff-guard";
 *
 * By default the caller is an admin who passes every check. `deny("staff")`
 * behaves like a non-staff user (redirect to /dashboard); `deny("capability")`
 * like staff without the page's capability (redirect to /admin). Redirects go
 * through the test file's own `next/navigation` mock.
 */
interface State {
  role: StaffRole;
  userId: string;
  denied: "staff" | "capability" | null;
}

const initial = (): State => ({ role: "admin", userId: "staff-1", denied: null });
let state: State = initial();

const requireStaff = vi.fn(async () => {
  if (state.denied) {
    redirect(state.denied === "staff" ? "/dashboard" : "/admin");
    throw new Error("NEXT_REDIRECT");
  }
  return {
    status: "staff" as const,
    user: { id: state.userId, app_metadata: { role: state.role }, is_anonymous: false },
    role: state.role,
    mfa: { status: "verified" as const, lastVerifiedAt: null },
  };
});

export const staffGuard = {
  requireStaff,
  as(role: StaffRole, userId = "staff-1") {
    state = { ...state, role, userId, denied: null };
  },
  deny(kind: "staff" | "capability") {
    state = { ...state, denied: kind };
  },
  reset() {
    state = initial();
    requireStaff.mockClear();
  },
};

export const staffGuardModule = {
  requireStaff,
  getStaffSession: vi.fn(async () => requireStaff()),
};
