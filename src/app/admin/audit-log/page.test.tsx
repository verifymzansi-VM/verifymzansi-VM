import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import AdminAuditLogPage from "./page";

const { mockAdminFrom, redirectMock } = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mockAdminFrom })),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

type Result = { data: unknown[] | null; count?: number | null; error?: { message: string } | null };

/** audit_logs resolves at .range(); account_profiles at .in(). */
function tables(result: Result, names: Array<{ user_id: string; display_name: string }> = []) {
  const audit: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ["select", "order", "ilike", "eq", "gte", "lt"]) audit[m] = vi.fn(() => audit);
  audit.range = vi.fn().mockResolvedValue({ count: null, error: null, ...result });
  mockAdminFrom.mockImplementation((table: string) =>
    table === "audit_logs"
      ? audit
      : { select: () => ({ in: vi.fn().mockResolvedValue({ data: names }) }) }
  );
  return audit;
}

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: "log-1",
  action: "dsar_completed",
  actor_id: "admin-1",
  target_type: "dsar_case",
  metadata: {},
  created_at: "2026-03-17T10:00:00.000Z",
  ...overrides,
});

describe("AdminAuditLogPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
  });

  it("needs audit:view", async () => {
    tables({ data: [] });
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({}) }));
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("audit:view");
  });

  it("shows entries with the actor's name, and system events without crashing", async () => {
    tables(
      {
        data: [entry(), entry({ id: "log-2", action: "expire_due_items", actor_id: null })],
        count: 2,
      },
      [{ user_id: "admin-1", display_name: "Admin User" }]
    );

    render(await AdminAuditLogPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("dsar_completed")).toBeInTheDocument();
    expect(screen.getByText(/Admin User/)).toBeInTheDocument();
    expect(screen.getByText(/System/)).toBeInTheDocument();
  });

  it("pages through every entry, keeping the filters", async () => {
    const audit = tables({
      data: Array.from({ length: 50 }, (_, i) => entry({ id: `l${i}` })),
      count: 120,
    });

    render(
      await AdminAuditLogPage({ searchParams: Promise.resolve({ action: "dsar_", page: "2" }) })
    );

    expect(audit.range).toHaveBeenCalledWith(50, 99);
    expect(audit.select).toHaveBeenCalledWith("*", { count: "exact" });
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

  it("estimates the unfiltered total rather than counting the whole table", async () => {
    const audit = tables({ data: [entry()], count: 90_000 });
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({}) }));
    expect(audit.select).toHaveBeenCalledWith("*", { count: "estimated" });
    expect(screen.getByText(/About 90[\s,]000 entries/)).toBeInTheDocument();
  });

  it("offers older entries after a full page even when the estimated total is low", async () => {
    tables({ data: Array.from({ length: 50 }, (_, i) => entry({ id: `l${i}` })), count: 40 });
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "Older entries" })).toHaveAttribute(
      "href",
      "/admin/audit-log?page=2"
    );
  });

  it("matches the action prefix literally, not with _ as a wildcard", async () => {
    const audit = tables({ data: [], count: 0 });
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({ action: "dsar_" }) }));
    expect(audit.ilike).toHaveBeenCalledWith("action", "dsar\\_%");
  });

  it("says when a filter matches nothing, and how to clear it", async () => {
    tables({ data: [], count: 0 });
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({ type: "dsar_case" }) }));
    expect(screen.getByText(/No audit entries match these filters/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear the filters" })).toHaveAttribute(
      "href",
      "/admin/audit-log"
    );
  });

  it("explains an ID filter it could not use instead of ignoring it", async () => {
    const audit = tables({ data: [], count: 0 });
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({ actor: "not-an-id" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Staff / actor ID must be a full ID");
    expect(audit.eq).not.toHaveBeenCalledWith("actor_id", expect.anything());
  });

  it("shows an error, not an empty log, when the read fails", async () => {
    tables({ data: null, error: { message: "timeout" } });
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("No audit entries recorded yet.")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing has been recorded", async () => {
    tables({ data: [], count: 0 });
    render(await AdminAuditLogPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("No audit entries recorded yet.")).toBeInTheDocument();
  });
});
