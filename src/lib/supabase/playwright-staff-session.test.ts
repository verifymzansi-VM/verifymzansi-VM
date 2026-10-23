import { describe, expect, it, vi } from "vitest";
import {
  createPlaywrightSession,
  listPlaywrightTableRows,
  writePlaywrightTableRows,
  playwrightSessionId,
} from "./playwright-fixture-store";
import { createPlaywrightStubSupabaseClient } from "./playwright-stub";
import { hasActiveStaffSession } from "@/lib/auth/staff-session";
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createPlaywrightStubSupabaseClient(),
}));
describe("synthetic privileged-session lifecycle", () => {
  it("denies a still-issued MFA token after the live session is downgraded", async () => {
    const session = createPlaywrightSession("kyc-reviewer-downgrade-regression");
    const client = createPlaywrightStubSupabaseClient({ sessionToken: session.token });
    expect(await hasActiveStaffSession(client, session.user.id)).toBe(true);
    const sessionId = playwrightSessionId(session.token);
    writePlaywrightTableRows(
      "auth_sessions",
      listPlaywrightTableRows("auth_sessions").map((row) =>
        row.id === sessionId ? { ...row, aal: "aal1" } : row
      )
    );
    expect((await client.auth.getClaims()).data?.claims.aal).toBe("aal2");
    expect(await hasActiveStaffSession(client, session.user.id)).toBe(false);
    writePlaywrightTableRows(
      "auth_sessions",
      listPlaywrightTableRows("auth_sessions").map((row) =>
        row.id === sessionId ? { ...row, issued_aal: "aal1" } : row
      )
    );
    expect(await hasActiveStaffSession(client, session.user.id)).toBe(true);
  });
  it("denies MFA authority after the verified authenticator is removed", async () => {
    const session = createPlaywrightSession("kyc-reviewer-factor-removal-regression");
    const client = createPlaywrightStubSupabaseClient({ sessionToken: session.token });
    expect(await hasActiveStaffSession(client, session.user.id)).toBe(true);
    writePlaywrightTableRows(
      "auth_mfa_factors",
      listPlaywrightTableRows("auth_mfa_factors").filter((row) => row.user_id !== session.user.id)
    );
    expect(await hasActiveStaffSession(client, session.user.id)).toBe(false);
  });
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
