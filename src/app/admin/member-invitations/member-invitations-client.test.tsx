import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberInvitation } from "@/lib/admin/member-invitations";
import { MemberInvitationsClient } from "./member-invitations-client";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

const waiting: MemberInvitation = {
  email: "lerato@example.co.za",
  invitedAt: "2026-11-19T08:00:00Z",
  expiresAt: "2026-12-19T08:00:00Z",
  claimedAt: null,
  revokedAt: null,
  status: "open",
  registered: false,
};
const rows: MemberInvitation[] = [
  waiting,
  {
    ...waiting,
    email: "sibusiso@example.com",
    status: "used",
    registered: true,
    claimedAt: waiting.invitedAt,
  },
  {
    ...waiting,
    email: "pieter@example.co.za",
    status: "revoked",
    revokedAt: "2026-11-10T08:00:00Z",
  },
  { ...waiting, email: "nomsa@example.com", status: "expired", expiresAt: "2026-11-02T08:00:00Z" },
];

function renderScreen(invitations = rows) {
  return render(
    <MemberInvitationsClient
      invitations={invitations}
      registerUrl="https://verifymzansi.com/register"
      loginUrl="https://verifymzansi.com/login"
    />
  );
}

async function invite(address: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email address"), address);
  await user.click(screen.getByRole("button", { name: "Invite" }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("MemberInvitationsClient", () => {
  it("lists each invitation with one status and one date; Withdraw only on waiting rows", () => {
    renderScreen();
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "lerato@example.co.zaWaiting to joinLasts until 19 Dec 2026Withdraw",
      "sibusiso@example.comJoinedInvited 19 Nov 2026",
      "pieter@example.co.zaWithdrawnWithdrawn 10 Nov 2026",
      "nomsa@example.comExpiredExpired 2 Nov 2026",
    ]);
    expect(screen.getAllByRole("button", { name: /Withdraw/ })).toHaveLength(1);
    expect(screen.getByText("Newest first")).toBeVisible();
    expect(screen.getByText(/It never gives staff access\./)).toBeVisible();
  });

  it("shows the empty state", () => {
    renderScreen([]);
    expect(screen.getByText("No invitations yet")).toBeVisible();
    expect(screen.getByText("People you invite appear here.")).toBeVisible();
    expect(screen.queryByText("Newest first")).toBeNull();
  });

  it("invites, then shows the link to send and highlights the new row", async () => {
    reply(200, {
      email: "thandi@example.co.za",
      invitedAt: "2026-11-20T08:00:00Z",
      expiresAt: "2026-12-20T08:00:00Z",
    });
    renderScreen();
    await invite("Thandi@Example.co.za");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "Invited thandi@example.co.za. We don't email them. Send them this link and ask them to sign up with that email:"
    );
    expect(within(status).getByText("verifymzansi.com/register")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/member-invitations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "invite", email: "thandi@example.co.za" }),
      })
    );
    expect(screen.getByLabelText("Email address")).toHaveValue("");
    expect(refresh).toHaveBeenCalled();
  });

  it("copies the sign-up link", async () => {
    reply(200, { email: "t@example.co.za", invitedAt: "x", expiresAt: "2026-12-20T08:00:00Z" });
    renderScreen();
    const user = await invite("t@example.co.za");
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://verifymzansi.com/register");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible();
  });

  it("says an address already waiting was renewed, not refused", async () => {
    reply(200, { email: waiting.email, invitedAt: "x", expiresAt: "2026-12-20T08:00:00Z" });
    renderScreen();
    await invite(waiting.email);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Already invited. The invitation now lasts until 20 Dec 2026. Send them the link again if they lost it:"
    );
    expect(screen.getByLabelText("Email address")).toHaveValue(waiting.email);
  });

  it("says an address with an account can sign in, and marks the field", async () => {
    reply(409, {
      error: "This email already has an account.",
      reason: "member_invitation_account_exists",
    });
    renderScreen();
    await invite("sibusiso@example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This email already has an account. They can sign in at verifymzansi.com/login."
    );
    expect(screen.getByLabelText("Email address")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the daily limit and the admin-only refusal as given", async () => {
    reply(429, {
      error: "You've reached today's limit of 200 invitations. Try again tomorrow.",
      reason: "member_invitation_limit",
    });
    renderScreen();
    await invite("zanele@example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You've reached today's limit of 200 invitations. Try again tomorrow."
    );
    expect(screen.getByLabelText("Email address")).not.toHaveAttribute("aria-invalid");
  });

  it("sends staff to verify their authenticator again and back", async () => {
    reply(403, {
      error: "Verify your authenticator again, then reload the page.",
      reason: "staff_mfa_required",
      code: "step_up_required",
      redirectUrl: "/staff/two-step",
    });
    renderScreen();
    await invite("zanele@example.com");
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/staff/two-step?next=%2Fadmin%2Fmember-invitations")
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks before withdrawing, then withdraws", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: /Withdraw/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Withdraw this invitation?");
    expect(dialog).toHaveTextContent(
      "lerato@example.co.za will no longer be able to sign up with it. You can invite them again later."
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    reply(200, { email: waiting.email, withdrawn: true });
    await user.click(screen.getByRole("button", { name: /Withdraw/ }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Withdraw" })
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/member-invitations",
      expect.objectContaining({
        body: JSON.stringify({ action: "withdraw", email: waiting.email }),
      })
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the dialog open with the reason when withdrawing fails", async () => {
    const user = userEvent.setup();
    reply(503, {
      error: "The invitation could not be confirmed. Reload the page before trying again.",
    });
    renderScreen();
    await user.click(screen.getByRole("button", { name: /Withdraw/ }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Withdraw" })
    );
    expect(await within(screen.getByRole("alertdialog")).findByRole("alert")).toHaveTextContent(
      "could not be confirmed"
    );
  });
});
