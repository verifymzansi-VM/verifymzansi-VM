import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import MemberInvitationsPage from "./page";

const { readMemberInvitations, redirectMock } = vi.hoisted(() => ({
  readMemberInvitations: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: vi.fn(async () => ({ api: { rpc: vi.fn() } })),
}));
vi.mock("@/lib/foundation/member-invitations", () => ({ readMemberInvitations }));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

describe("MemberInvitationsPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    readMemberInvitations.mockResolvedValue({ mode: "invite_only", items: [] });
  });

  it("needs member:invite (admins only)", async () => {
    render(await MemberInvitationsPage());
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("member:invite");
  });

  it("says sign-up is by invitation and points to Staff roles for staff", async () => {
    render(await MemberInvitationsPage());
    expect(screen.getByRole("heading", { level: 1, name: "Member invitations" })).toBeVisible();
    expect(
      screen.getByText(/Sign-up is by invitation only\. To make someone staff, use/)
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Staff roles" })).toHaveAttribute(
      "href",
      "/admin/governance/roles"
    );
    expect(screen.getByText("No invitations yet")).toBeVisible();
  });

  it("says invitations are not needed while sign-up is open", async () => {
    readMemberInvitations.mockResolvedValue({ mode: "open", items: [] });
    render(await MemberInvitationsPage());
    expect(
      screen.getByText(/Sign-up is open to everyone, so invitations aren't needed/)
    ).toBeVisible();
    // The form stays usable.
    expect(screen.getByRole("button", { name: "Invite" })).toBeEnabled();
  });

  it("sends staff to verify their authenticator again, then back here", async () => {
    readMemberInvitations.mockRejectedValue(
      new FoundationStaffCommandError(403, "Verify again", true)
    );
    await expect(MemberInvitationsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/staff/two-step?next=%2Fadmin%2Fmember-invitations");
  });

  it("does not claim an empty list when the read fails", async () => {
    readMemberInvitations.mockRejectedValue(new Error("down"));
    render(await MemberInvitationsPage());
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("No invitations yet")).toBeNull();
  });
});
