import { describe, expect, it, vi } from "vitest";
import { createPlaywrightSession } from "./playwright-fixture-store";
import { createPlaywrightStubSupabaseClient } from "./playwright-stub";
import { hasActiveStaffSession } from "@/lib/auth/staff-session";
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createPlaywrightStubSupabaseClient(),
}));
describe("synthetic privileged-session lifecycle", () => {
  it("allows active, denies cross-user, and rejects replay after sign-out", async () => {
    const session = createPlaywrightSession("kyc-reviewer-session-regression");
    const client = createPlaywrightStubSupabaseClient({ sessionToken: session.token });
    expect(await hasActiveStaffSession(client, session.user.id)).toBe(true);
    expect(await hasActiveStaffSession(client, "other-user")).toBe(false);
    await client.auth.signOut();
    expect(await hasActiveStaffSession(client, session.user.id)).toBe(false);
    const relogin = createPlaywrightSession("kyc-reviewer-session-regression");
    expect(relogin.token).not.toBe(session.token);
    expect(
      await hasActiveStaffSession(
        createPlaywrightStubSupabaseClient({ sessionToken: relogin.token }),
        relogin.user.id
      )
    ).toBe(true);
    expect(await hasActiveStaffSession(client, session.user.id)).toBe(false);
    expect(
      await hasActiveStaffSession(
        createPlaywrightStubSupabaseClient({ sessionToken: encodeURIComponent(session.token) }),
        session.user.id
      )
    ).toBe(false);
  });
});
