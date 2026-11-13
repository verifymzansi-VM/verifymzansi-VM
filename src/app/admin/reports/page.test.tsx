import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import AdminReportsPage from "./page";

const { readFrontendReportQueue, readFoundationServerSession, redirectMock } = vi.hoisted(() => ({
  readFrontendReportQueue: vi.fn(),
  readFoundationServerSession: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession }));
vi.mock("@/lib/foundation/report-queue", () => ({ readFrontendReportQueue }));

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
  const api = { rpc: vi.fn() };

  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    readFoundationServerSession.mockResolvedValue({ api, user: { id: "staff-1" } });
  });

  /** The foundation report queue: open, in progress and recently closed. */
  function reportQueue(byStatus: Record<string, unknown[]>, openTotal?: number) {
    const open = byStatus.open ?? [];
    readFrontendReportQueue.mockResolvedValue({
      reports: [...open, ...(byStatus.in_progress ?? []), ...(byStatus.closed ?? [])],
      open,
      openTotal: openTotal ?? open.length,
      myClaims: 0,
      claims: {},
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

  it("loads open, in-progress and recently closed reports from the foundation queue", async () => {
    reportQueue({
      open: [report("report-1", "open")],
      in_progress: [report("report-2", "in_progress")],
      closed: [report("report-3", "resolved")],
    });

    render(await AdminReportsPage());

    expect(readFrontendReportQueue).toHaveBeenCalledWith(api, "staff-1");
    expect(screen.getByTestId("reports-client")).toHaveTextContent("3 reports");
    expect(screen.getByText("1 open")).toBeInTheDocument();
  });

  it("says when more open reports exist than are shown", async () => {
    reportQueue({ open: [report("report-1", "open")] }, 260);

    render(await AdminReportsPage());

    expect(screen.getByText("260 open")).toBeInTheDocument();
    expect(screen.getByText(/Showing the first 1 of 260 open reports/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no reports", async () => {
    reportQueue({});

    render(await AdminReportsPage());

    expect(screen.getByText("No reports to review.")).toBeInTheDocument();
  });

  it("says so instead of showing an empty queue when the read fails", async () => {
    readFrontendReportQueue.mockRejectedValue(new Error("timeout"));

    render(await AdminReportsPage());

    expect(screen.getByRole("alert")).toHaveTextContent("Reports could not be loaded");
  });
});
