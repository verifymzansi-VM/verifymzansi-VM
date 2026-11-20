import { describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { readMemberInvitations } from "./member-invitations";
import { FoundationStaffCommandError } from "./staff-command";

const row = {
  email: "lerato@example.co.za",
  invited_at: "2026-11-19T08:00:00.123456+00:00",
  expires_at: "2026-12-19T08:00:00.123456+00:00",
  claimed_at: null,
  revoked_at: null,
  status: "open",
  registered: false,
};

function apiAnswering(
  list: unknown,
  mode: unknown = { data: { mode: "invite_only" }, error: null }
) {
  const rpc = vi.fn(async (name: string) => (name === "get_signup_mode" ? mode : list));
  return { api: { rpc } as unknown as FoundationAuthenticatedApi, rpc };
}

describe("readMemberInvitations", () => {
  it("reads the list and the sign-up mode", async () => {
    const { api, rpc } = apiAnswering({ data: { items: [row] }, error: null });
    await expect(readMemberInvitations(api)).resolves.toEqual({
      mode: "invite_only",
      items: [
        {
          email: row.email,
          invitedAt: row.invited_at,
          expiresAt: row.expires_at,
          claimedAt: null,
          revokedAt: null,
          status: "open",
          registered: false,
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith("list_member_invitations", {}, { get: false });
    expect(rpc).toHaveBeenCalledWith("get_signup_mode", {}, { get: false });
  });

  it("leaves the mode out when it cannot be read, but still lists", async () => {
    const { api } = apiAnswering(
      { data: { items: [] }, error: null },
      { data: null, error: { code: "XX000" } }
    );
    await expect(readMemberInvitations(api)).resolves.toEqual({ mode: null, items: [] });
  });

  it("never passes on fields the screen does not show (who invited)", async () => {
    const { api } = apiAnswering({ data: { items: [{ ...row, invited_by: "x" }] }, error: null });
    await expect(readMemberInvitations(api)).rejects.toThrow("could not be confirmed");
  });

  it("asks staff to verify again when the authenticator check expired", async () => {
    const { api } = apiAnswering({
      data: null,
      error: { code: "42501", message: "staff second-factor verification expired" },
    });
    const thrown = await readMemberInvitations(api).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(FoundationStaffCommandError);
    expect(thrown).toMatchObject({ mfaRequired: true });
  });
});
