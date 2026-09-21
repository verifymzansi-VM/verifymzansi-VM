import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser, verifyStaff, createAdmin, range, auditLimit, query } = vi.hoisted(() => {
  const range = vi.fn();
  const auditLimit = vi.fn();
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    range,
    limit: auditLimit,
  };
  return { getUser: vi.fn(), verifyStaff: vi.fn(), createAdmin: vi.fn(), range, auditLimit, query };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdmin }));
vi.mock("@/lib/auth/admin-access", () => ({ verifyStaffActorRoleFromDb: verifyStaff }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("./support-inbox-client", () => ({ SupportInboxClient: () => <div>Saved requests</div> }));

import Page from "./page";

describe("Support inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "staff" } } });
    verifyStaff.mockResolvedValue("admin");
    createAdmin.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
    for (const method of [query.select, query.order, query.eq, query.in])
      method.mockReturnValue(query);
    range.mockResolvedValue({ data: [], count: 0, error: null });
    auditLimit.mockResolvedValue({ data: [], error: null });
  });

  it("does not expose submissions when a staff role was revoked", async () => {
    verifyStaff.mockResolvedValue(null);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect");
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("shows a read error instead of falsely reporting an empty inbox", async () => {
    range.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("No support submissions yet.")).toBeNull();
  });

  it("allows staff to reach records beyond the former 200-row limit", async () => {
    range.mockResolvedValue({ data: [], count: 260, error: null });
    render(await Page({ searchParams: Promise.resolve({ page: "5" }) }));
    expect(range).toHaveBeenCalledWith(200, 249);
    expect(screen.getByRole("link", { name: "Older requests" })).toHaveAttribute(
      "href",
      "/admin/support?page=6"
    );
  });

  it("opens an exact request from a staff email without pagination hiding it", async () => {
    const id = "12bb6c4e-66e9-45e5-a479-fd6b2c0b0c27";
    render(await Page({ searchParams: Promise.resolve({ page: "9", submission: id }) }));
    expect(query.eq).toHaveBeenCalledWith("id", id);
    expect(range).toHaveBeenCalledWith(0, 0);
    expect(screen.getByRole("link", { name: "View all support requests" })).toBeInTheDocument();
  });
});
