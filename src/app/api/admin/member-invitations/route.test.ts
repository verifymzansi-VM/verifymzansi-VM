/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST } from "./route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  MemberInvitationRefused,
  memberInvitationRefusal,
} from "@/lib/foundation/member-invitations";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";

vi.mock("@/lib/foundation/owner-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleFoundationOwnerRoute: vi.fn(),
}));

type OwnerRouteOptions = Parameters<typeof handleFoundationOwnerRoute>[0];

const rpc = vi.fn();
const api = { rpc } as unknown as Parameters<OwnerRouteOptions["command"]>[0];
const INVITED = "2026-11-20T08:00:00.123456+00:00";
const EXPIRES = "2026-12-20T08:00:00.123456+00:00";

async function options() {
  await POST(
    new NextRequest("https://verifymzansi.com/api/admin/member-invitations", { method: "POST" })
  );
  return vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0] as OwnerRouteOptions;
}

/** What the route answers for a command failure, through its own refusal map. */
async function refusalFor(error: unknown, input: unknown = { action: "invite", email: "a@b.co" }) {
  const route = await options();
  rpc.mockResolvedValueOnce({ data: null, error });
  try {
    await route.command(api, input);
  } catch (thrown) {
    return route.refusal(thrown);
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValue(NextResponse.json({ ok: true }));
});

// handleFoundationOwnerRoute owns same-origin, CSRF, the per-client rate
// limit, sign-in and body limits (src/lib/foundation/owner-route.test.ts).
describe("POST /api/admin/member-invitations", () => {
  it("is a guarded write with its own rate-limit bucket", async () => {
    const route = await options();
    expect(route).toMatchObject({
      action: "admin:member-invitations",
      mutate: true,
      refusal: memberInvitationRefusal,
    });
  });

  it("invites through api.invite_member and returns the new expiry", async () => {
    const route = await options();
    rpc.mockResolvedValue({
      data: { email: "thandi@example.co.za", invited_at: INVITED, expires_at: EXPIRES },
      error: null,
    });
    await expect(
      route.command(api, { action: "invite", email: "  Thandi@Example.co.za " })
    ).resolves.toEqual({
      email: "thandi@example.co.za",
      invitedAt: INVITED,
      expiresAt: EXPIRES,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "invite_member",
      { p_email: "Thandi@Example.co.za" },
      { get: false }
    );
  });

  it("withdraws through api.revoke_member_invitation", async () => {
    const route = await options();
    rpc.mockResolvedValue({ data: { email: "thandi@example.co.za", revoked: true }, error: null });
    await expect(
      route.command(api, { action: "withdraw", email: "thandi@example.co.za" })
    ).resolves.toEqual({ email: "thandi@example.co.za", withdrawn: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "revoke_member_invitation",
      { p_email: "thandi@example.co.za" },
      { get: false }
    );
  });

  it("refuses other actions and extra fields before calling the database", async () => {
    const route = await options();
    for (const input of [
      { action: "grant", email: "a@b.co" },
      { action: "invite", email: "a@b.co", role: "admin" },
      "not an object",
    ]) {
      const thrown = await route.command(api, input).catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(z.ZodError);
      // Not the address's fault, so the screen does not blame the address.
      expect(route.refusal(thrown)).toEqual({
        status: 422,
        error: "This request could not be read. Reload the page and try again.",
        reason: "member_invitation_request_invalid",
      });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a bad address as an invalid address before calling the database", async () => {
    const route = await options();
    for (const input of [
      { action: "invite", email: "x".repeat(255) },
      { action: "invite" },
      { action: "invite", email: "a" },
      // A NUL byte or another control character never reaches the database
      // (it answered 503 before; now the screen's own 422).
      { action: "invite", email: "thandi\u0000@example.co.za" },
      { action: "withdraw", email: "thandi@example.co.za\u0007" },
      { action: "invite", email: "thandi\u0009x@example.co.za" },
    ]) {
      const thrown = await route.command(api, input).catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(z.ZodError);
      expect(route.refusal(thrown)).toEqual({
        status: 422,
        error: "Enter a valid email address.",
        reason: "member_invitation_email_invalid",
      });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("words each database refusal for the screen", async () => {
    await expect(
      refusalFor({
        code: "PT409",
        message: "This person already has an account.",
        details: "member_invitation_account_exists",
      })
    ).resolves.toEqual({
      status: 409,
      error: "This email already has an account.",
      reason: "member_invitation_account_exists",
    });
    await expect(
      refusalFor({ code: "54000", message: "member_invitation_limit" })
    ).resolves.toEqual({
      status: 429,
      error: "You've reached today's limit of 200 invitations. Try again tomorrow.",
      reason: "member_invitation_limit",
    });
    await expect(
      refusalFor({ code: "22023", message: "member_invitation_email_invalid" })
    ).resolves.toMatchObject({ status: 422, reason: "member_invitation_email_invalid" });
    await expect(refusalFor({ code: "42501", message: "capability not granted" })).resolves.toEqual(
      {
        status: 403,
        error: "Only admins can invite members.",
        reason: "member_invitation_not_allowed",
      }
    );
  });

  it("sends staff to verify their authenticator again", async () => {
    for (const message of [
      "staff second-factor verification expired",
      "verified authenticator app required",
    ])
      await expect(refusalFor({ code: "42501", message })).resolves.toMatchObject({
        status: 403,
        reason: "staff_mfa_required",
        code: "step_up_required",
        redirectUrl: "/staff/two-step",
      });
  });

  it("leaves other failures to the generic unavailable answer", async () => {
    await expect(refusalFor({ code: "XX000", message: "boom" })).resolves.toBeNull();
    // A reason the screen does not know, under a known code, is not guessed at.
    await expect(
      refusalFor({ code: "PT409", message: "other", details: "no_account" })
    ).resolves.toBeNull();
    // A malformed answer is not trusted.
    const route = await options();
    rpc.mockResolvedValue({ data: { email: "a@b.co" }, error: null });
    const thrown = await route
      .command(api, { action: "invite", email: "a@b.co" })
      .catch((error: unknown) => error);
    expect(route.refusal(thrown)).toBeNull();
  });

  it("maps a 42501 that is neither the factor nor the capability to a reload", async () => {
    const refusal = await refusalFor({ code: "42501", message: "account suspended" });
    expect(refusal).toMatchObject({ status: 403, reason: "staff_command_refused" });
  });

  it("keeps the refusal types apart", () => {
    expect(
      memberInvitationRefusal(new MemberInvitationRefused(429, "member_invitation_limit"))
    ).toMatchObject({ status: 429, reason: "member_invitation_limit" });
    expect(memberInvitationRefusal(new FoundationStaffCommandError(403, "x", true))).toMatchObject({
      code: "step_up_required",
    });
    expect(memberInvitationRefusal(new Error("x"))).toBeNull();
  });
});
