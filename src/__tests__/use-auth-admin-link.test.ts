import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, fetchFoundationAccountSession } = vi.hoisted(() => ({
  getUser: vi.fn(),
  fetchFoundationAccountSession: vi.fn(),
}));
vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: () => ({
    auth: {
      getUser,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));
vi.mock("@/lib/foundation/account-session-client", () => ({ fetchFoundationAccountSession }));
vi.mock("@/lib/foundation/verification-runtime-client", () => ({
  readFoundationVerificationStatus: vi.fn(async () => ({})),
}));
vi.mock("@/lib/foundation/restored-profile", () => ({
  restoredAccountProfile: (account: { account_id: string }) => ({
    user_id: account.account_id,
    display_name: "Thando Dube",
  }),
}));

import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/auth-store";

const ACCOUNT_ID = "acct-1";
const admin = { role: "admin", can_access: false, assigned_capabilities: [] };

describe("useAuth showAdminLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().reset();
    document.cookie = "sb-projectref-auth-token=session; path=/";
    getUser.mockResolvedValue({
      data: { user: { id: ACCOUNT_ID, email: "person@example.test", user_metadata: {} } },
    });
  });

  it.each([
    ["an invited administrator without an authenticator app", admin, false, false],
    ["enrolled staff whose two-step check lapsed", admin, true, true],
    ["staff with a current two-step check", { ...admin, can_access: true }, true, true],
    ["a member", null, true, false],
  ])("for %s", async (_label, staff, totpEnrolled, expected) => {
    fetchFoundationAccountSession.mockResolvedValue({
      account_id: ACCOUNT_ID,
      email: "person@example.test",
      totp_enrolled: totpEnrolled,
      staff,
    });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user?.id).toBe(ACCOUNT_ID));
    expect(result.current.showAdminLink).toBe(expected);
    // The role and isStaff hint are unchanged for every other consumer.
    expect(result.current.isStaff).toBe(staff !== null);
  });
});
