import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import AdminAuditLogPage from "./page";

const { readRestoredStaffAudit, redirectMock } = vi.hoisted(() => ({
  readRestoredStaffAudit: vi.fn(),
  redirectMock: vi.fn(),
}));

const ACTOR = "11111111-1111-4111-8111-111111111111";
const api = { rpc: vi.fn() };

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: vi.fn(async () => ({ api, user: { id: ACTOR } })),
}));
vi.mock("@/lib/foundation/restored-staff-audit", () => ({ readRestoredStaffAudit }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: "audit:log-1",
  action: "dsar_completed",
  actor_id: ACTOR,
  actor_name: "Admin User",
  target_type: "case",
  target_id: null,
  occurred_at: "2026-03-17T10:00:00.000Z",
  reason: null,
  ...overrides,
});

describe("AdminAuditLogPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    readRestoredStaffAudit.mockResolvedValue({ total: 0, items: [] });
  });

  it("needs audit:view", async () => {
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({}) }));
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("audit:view");
  });

  it("shows entries with the actor's name, and system events without crashing", async () => {
    readRestoredStaffAudit.mockResolvedValue({
      total: 2,
      items: [
        entry(),
        entry({ id: "audit:log-2", action: "expire_due_items", actor_id: null, actor_name: null }),
      ],
    });

    render(await AdminAuditLogPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("dsar_completed")).toBeInTheDocument();
    expect(screen.getByText(/Admin User/)).toBeInTheDocument();
    expect(screen.getByText(/System/)).toBeInTheDocument();
  });

  it("pages through every entry, keeping the filters", async () => {
    readRestoredStaffAudit.mockResolvedValue({
      total: 120,
      items: Array.from({ length: 50 }, (_, i) => entry({ id: `audit:l${i}` })),
    });

    render(
      await AdminAuditLogPage({ searchParams: Promise.resolve({ action: "dsar_", page: "2" }) })
    );

    expect(readRestoredStaffAudit).toHaveBeenCalledWith(api, ACTOR, { page: 2, action: "dsar_" });
    expect(screen.getByText(/120 entries · Page 2 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Older entries" })).toHaveAttribute(
      "href",
      "/admin/audit-log?action=dsar_&page=3"
    );
    expect(screen.getByRole("link", { name: "Newer entries" })).toHaveAttribute(
      "href",
      "/admin/audit-log?action=dsar_"
    );
  });

  it("says when a filter matches nothing, and how to clear it", async () => {
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({ type: "case" }) }));
    expect(screen.getByText(/No audit entries match these filters/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear the filters" })).toHaveAttribute(
      "href",
      "/admin/audit-log"
    );
  });

  it("explains an ID filter it could not use instead of sending it", async () => {
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({ actor: "not-an-id" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Staff / actor ID must be a full ID");
    expect(readRestoredStaffAudit).toHaveBeenCalledWith(api, ACTOR, { page: 1 });
  });

  it("shows an error, not an empty log, when the read fails", async () => {
    readRestoredStaffAudit.mockRejectedValue(new Error("timeout"));
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("No audit entries recorded yet.")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing has been recorded", async () => {
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("No audit entries recorded yet.")).toBeInTheDocument();
  });
});
