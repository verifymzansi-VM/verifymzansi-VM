import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import { render, screen } from "@testing-library/react";

const { readInbox, readSession } = vi.hoisted(() => ({
  readInbox: vi.fn(),
  readSession: vi.fn(),
}));
vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession: readSession }));
vi.mock("@/lib/foundation/support-inbox", () => ({ readFrontendSupportInbox: readInbox }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("./support-inbox-client", () => ({
  SupportInboxClient: ({ canRespond }: { canRespond: boolean }) => (
    <div data-can-respond={String(canRespond)}>Saved requests</div>
  ),
}));

import Page from "./page";

const api = { fixture: "api" };
const submission = {
  id: "s1",
  name: "A",
  email: "a@example.com",
  message: "Help",
  status: "new",
  created_at: "2026-11-01T10:00:00Z",
  revision: 1,
  emailActivity: [],
};

describe("Support inbox", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    readSession.mockResolvedValue({ api });
    readInbox.mockResolvedValue({ items: [], total: 0, can_update: true });
  });

  it("does not expose submissions when a staff role was revoked", async () => {
    staffGuard.deny("staff");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect");
    expect(readInbox).not.toHaveBeenCalled();
  });

  it("shows a read error instead of falsely reporting an empty inbox", async () => {
    readInbox.mockRejectedValue(new Error("Unavailable"));
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("No support submissions yet.")).toBeNull();
  });

  it("allows staff to page through every request", async () => {
    readInbox.mockResolvedValue({ items: [], total: 260, can_update: true });
    render(await Page({ searchParams: Promise.resolve({ page: "5" }) }));
    expect(readInbox).toHaveBeenCalledWith(api, "staff-1", 5, undefined);
    expect(screen.getByRole("link", { name: "Older requests" })).toHaveAttribute(
      "href",
      "/admin/support?page=6"
    );
  });

  it("opens an exact request from a staff email without pagination hiding it", async () => {
    const id = "12bb6c4e-66e9-45e5-a479-fd6b2c0b0c27";
    render(await Page({ searchParams: Promise.resolve({ page: "9", submission: id }) }));
    expect(readInbox).toHaveBeenCalledWith(api, "staff-1", 9, id);
    expect(screen.getByRole("link", { name: "View all support requests" })).toBeInTheDocument();
  });

  it("shows update controls only when the database allows them", async () => {
    readInbox.mockResolvedValue({ items: [submission], total: 1, can_update: false });
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Saved requests")).toHaveAttribute("data-can-respond", "false");
    expect(screen.getByText(/Moderators and admins update their status/)).toBeInTheDocument();

    readInbox.mockResolvedValue({ items: [submission], total: 1, can_update: true });
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("Saved requests")[1]).toHaveAttribute("data-can-respond", "true");
  });
});
