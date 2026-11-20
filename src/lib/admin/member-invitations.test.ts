import { describe, expect, it } from "vitest";
import {
  displayLink,
  formatInvitationDate,
  memberInvitationView,
  renewsWaitingInvitation,
  type MemberInvitation,
} from "./member-invitations";

const base: MemberInvitation = {
  email: "lerato@example.co.za",
  invitedAt: "2026-11-19T08:00:00+00:00",
  expiresAt: "2026-12-19T08:00:00+00:00",
  claimedAt: null,
  revokedAt: null,
  status: "open",
  registered: false,
};

describe("member invitation rows", () => {
  it("formats dates in South African time", () => {
    expect(formatInvitationDate("2026-12-19T08:00:00+00:00")).toBe("19 Dec 2026");
    // 22:30 UTC is already the next day in South Africa.
    expect(formatInvitationDate("2026-11-01T22:30:00Z")).toBe("2 Nov 2026");
    expect(formatInvitationDate("not a date")).toBe("");
  });

  it("shows one status and one date per row; only waiting rows can be withdrawn", () => {
    expect(memberInvitationView(base)).toEqual({
      state: "waiting",
      label: "Waiting to join",
      badge: "pending",
      dateLine: "Lasts until 19 Dec 2026",
      canWithdraw: true,
    });
    expect(
      memberInvitationView({ ...base, status: "used", claimedAt: base.invitedAt, registered: true })
    ).toMatchObject({
      label: "Joined",
      badge: "live",
      dateLine: "Invited 19 Nov 2026",
      canWithdraw: false,
    });
    expect(
      memberInvitationView({ ...base, status: "revoked", revokedAt: "2026-11-10T09:00:00Z" })
    ).toMatchObject({
      label: "Withdrawn",
      badge: "draft",
      dateLine: "Withdrawn 10 Nov 2026",
      canWithdraw: false,
    });
    expect(
      memberInvitationView({ ...base, status: "expired", expiresAt: "2026-11-02T09:00:00Z" })
    ).toMatchObject({
      label: "Expired",
      badge: "draft",
      dateLine: "Expired 2 Nov 2026",
      canWithdraw: false,
    });
  });

  it("shows Joined for a registered account whatever the invitation's status", () => {
    expect(
      memberInvitationView({
        ...base,
        status: "revoked",
        revokedAt: base.invitedAt,
        registered: true,
      }).state
    ).toBe("joined");
  });

  it("knows when inviting again renews a waiting invitation", () => {
    expect(renewsWaitingInvitation([base], " Lerato@Example.co.za ")).toBe(true);
    expect(renewsWaitingInvitation([{ ...base, status: "expired" }], base.email)).toBe(false);
    expect(renewsWaitingInvitation([{ ...base, status: "revoked" }], base.email)).toBe(false);
    expect(renewsWaitingInvitation([], base.email)).toBe(false);
  });

  it("shows links without the protocol", () => {
    expect(displayLink("https://verifymzansi.com/register")).toBe("verifymzansi.com/register");
  });
});
