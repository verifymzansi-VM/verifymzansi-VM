import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FreeCredit } from "@/lib/admin/free-credits";
import { FreeCreditsClient } from "./free-credits-client";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const ID = "6f1d3c1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f";

const active: FreeCredit = {
  id: ID,
  member: "t***@example.co.za",
  posts: 1,
  startsAt: "2026-11-22T08:00:00Z",
  endsAt: "2026-12-22T08:00:00Z",
  status: "active",
  views: 42,
};
const rows: FreeCredit[] = [
  active,
  {
    ...active,
    id: "7f1d3c1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f",
    member: "s***@example.com",
    posts: 3,
    endsAt: "2026-11-10T08:00:00Z",
    status: "ended",
    views: 1,
  },
  {
    ...active,
    id: "8f1d3c1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f",
    member: null,
    status: "ended",
    views: 0,
  },
];

function sent() {
  return JSON.parse(String(fetchMock.mock.calls[0][1].body));
}

async function fillGive(user: ReturnType<typeof userEvent.setup>, reason: string) {
  await user.type(screen.getByLabelText(/email/), "thandi@example.co.za");
  await user.type(screen.getByLabelText("Reason"), reason);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("FreeCreditsClient", () => {
  it("lists each gift: member, status, posts, end date and views; Extend unless closed", () => {
    render(<FreeCreditsClient gifts={rows} />);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "t***@example.co.zaActive1 post · until 22 Dec 2026 · 42 viewsExtend",
      "s***@example.comEnded3 posts · ended 10 Nov 2026 · 1 viewExtend",
      "Closed accountEnded1 post · ended 22 Dec 2026 · 0 views",
    ]);
    expect(screen.getAllByRole("button", { name: /^Extend the free credits/ })).toHaveLength(2);
  });

  it("shows the empty state", () => {
    render(<FreeCreditsClient gifts={[]} />);
    expect(screen.getByText("No free credits yet")).toBeVisible();
  });

  it("gives 1 post for 30 days by default and refreshes the list", async () => {
    const user = userEvent.setup();
    render(<FreeCreditsClient gifts={[]} />);
    expect(screen.getByLabelText("Posts")).toHaveValue("1");
    expect(screen.getByLabelText("Days")).toHaveValue(30);
    await fillGive(user, "Recruited at the market day");
    reply(200, { id: ID, posts: 1, endsAt: "2026-12-22T08:00:00Z" });
    await user.click(screen.getByRole("button", { name: "Give" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Gave 1 post until 22 Dec 2026.");
    expect(sent()).toEqual({
      action: "give",
      email: "thandi@example.co.za",
      posts: 1,
      days: 30,
      reason: "Recruited at the market day",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/free-credits");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByLabelText(/email/)).toHaveValue("");
  });

  it("sends the chosen posts and days", async () => {
    const user = userEvent.setup();
    render(<FreeCreditsClient gifts={[]} />);
    await fillGive(user, "Recruited at the market day");
    await user.selectOptions(screen.getByLabelText("Posts"), "6");
    await user.clear(screen.getByLabelText("Days"));
    await user.type(screen.getByLabelText("Days"), "7");
    reply(200, { id: ID, posts: 6, endsAt: "2026-11-29T08:00:00Z" });
    await user.click(screen.getByRole("button", { name: "Give" }));
    await screen.findByRole("status");
    expect(sent()).toMatchObject({ posts: 6, days: 7 });
  });

  it("shows the database's refusal", async () => {
    const user = userEvent.setup();
    render(<FreeCreditsClient gifts={[]} />);
    await fillGive(user, "Recruited at the market day");
    reply(409, {
      error: "This member's ID review isn't accepted yet.",
      reason: "free_credit_identity_required",
    });
    await user.click(screen.getByRole("button", { name: "Give" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ID review isn't accepted yet");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("checks the reason before sending", async () => {
    const user = userEvent.setup();
    render(<FreeCreditsClient gifts={[]} />);
    await fillGive(user, "abcd");
    await user.click(screen.getByRole("button", { name: "Give" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("5 to 200 characters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends staff with a stale authenticator code to verify again", async () => {
    const user = userEvent.setup();
    render(<FreeCreditsClient gifts={[]} />);
    await fillGive(user, "Recruited at the market day");
    reply(403, {
      error: "Verify your authenticator again, then try again.",
      reason: "staff_mfa_required",
      code: "step_up_required",
      redirectUrl: "/staff/two-step",
    });
    await user.click(screen.getByRole("button", { name: "Give" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/staff/two-step?next=%2Fadmin%2Ffree-credits")
    );
  });

  it("extends a gift by 30 days by default, after its end while it runs", async () => {
    const user = userEvent.setup();
    render(<FreeCreditsClient gifts={rows} />);
    await user.click(
      screen.getByRole("button", { name: "Extend the free credits for t***@example.co.za" })
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Days are added after 22 Dec 2026.");
    expect(within(dialog).getByLabelText("Days")).toHaveValue(30);
    await user.type(within(dialog).getByLabelText("Reason"), "Still recruiting");
    reply(200, { id: ID, posts: 1, endsAt: "2027-01-21T08:00:00Z" });
    await user.click(within(dialog).getByRole("button", { name: "Extend" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Extended until 21 Jan 2027.");
    expect(sent()).toEqual({ action: "extend", id: ID, days: 30, reason: "Still recruiting" });
    expect(refresh).toHaveBeenCalled();
  });

  it("extends an ended gift from today and shows a refusal inside the dialog", async () => {
    const user = userEvent.setup();
    render(<FreeCreditsClient gifts={rows} />);
    await user.click(
      screen.getByRole("button", { name: "Extend the free credits for s***@example.com" })
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Days are added from today.");
    await user.type(within(dialog).getByLabelText("Reason"), "Still recruiting");
    reply(409, { error: "This gift can't be extended.", reason: "free_credit_closed" });
    await user.click(within(dialog).getByRole("button", { name: "Extend" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("can't be extended");
  });
});
