import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import AdminReportsPage from "./page";

const { mockGetUser, mockSessionFrom, mockAdminFrom, redirectMock } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSessionFrom: vi.fn(),
  mockAdminFrom: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockSessionFrom,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({
    title,
    description,
    children,
  }: React.PropsWithChildren<{ title: string; description: string }>) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </div>
  ),
}));

vi.mock("./reports-client", () => ({
  ReportsClient: ({ reports }: { reports: Array<{ id: string }> }) => (
    <div data-testid="reports-client">{reports.length} reports</div>
  ),
}));

describe("AdminReportsPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "moderator-1", app_metadata: { role: "moderator" } } },
    });
  });

  /** Reports by status: open, in progress, and recently closed. */
  function reportsByStatus(byStatus: Record<string, unknown[]>, openCount?: number) {
    mockAdminFrom.mockImplementation(() => {
      let status = "";
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn((_col: string, value: string) => {
        status = value;
        return q;
      });
      q.in = vi.fn(() => {
        status = "closed";
        return q;
      });
      q.order = vi.fn(() => q);
      q.limit = vi.fn(async () => ({
        data: byStatus[status] ?? [],
        count: status === "open" ? (openCount ?? (byStatus.open ?? []).length) : null,
        error: null,
      }));
      return q;
    });
  }

  const report = (id: string, status: string) => ({
    id,
    status,
    target_id: "listing-1",
    target_type: "listing",
    area: "MZANSI_MARKET",
    category: "scam",
    severity: "high",
    description: "Suspicious listing",
    reporter_user_id: null,
    created_at: "2026-03-17T10:00:00.000Z",
    updated_at: "2026-03-17T10:00:00.000Z",
  });

  it("loads open, in-progress and recently closed reports through the admin client", async () => {
    reportsByStatus({
      open: [report("report-1", "open")],
      in_progress: [report("report-2", "in_progress")],
      closed: [report("report-3", "resolved")],
    });

    render(await AdminReportsPage());

    expect(mockSessionFrom).not.toHaveBeenCalled();
    expect(mockAdminFrom).toHaveBeenCalledWith("reports");
    expect(screen.getByTestId("reports-client")).toHaveTextContent("3 reports");
    expect(screen.getByText("1 open")).toBeInTheDocument();
  });

  it("says when more open reports exist than are shown", async () => {
    reportsByStatus({ open: [report("report-1", "open")] }, 260);

    render(await AdminReportsPage());

    expect(screen.getByText("260 open")).toBeInTheDocument();
    expect(screen.getByText(/Showing the first 1 of 260 open reports/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no reports", async () => {
    reportsByStatus({});

    render(await AdminReportsPage());

    expect(screen.getByText("No reports to review.")).toBeInTheDocument();
  });
});
