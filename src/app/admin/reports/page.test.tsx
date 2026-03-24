import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminReportsPage from "./page";

const { mockGetUser, mockSessionFrom, mockAdminFrom, redirectMock } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSessionFrom: vi.fn(),
  mockAdminFrom: vi.fn(),
  redirectMock: vi.fn(),
}));

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

vi.mock("@/lib/auth/roles", () => ({
  isModeratorOrAdmin: vi.fn(() => true),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
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
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "moderator-1", app_metadata: { role: "moderator" } } },
    });
  });

  it("reads reports through the admin client after auth gating", async () => {
    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                id: "report-1",
                status: "open",
                target_id: "listing-1",
                target_type: "listing",
                area: "MZANSI_MARKET",
                category: "scam",
                severity: "high",
                description: "Suspicious listing",
                screenshot_url: null,
                reporter_user_id: null,
                reporter_ip_hash: "hash",
                assigned_to: null,
                resolved_at: null,
                created_at: "2026-03-17T10:00:00.000Z",
                updated_at: "2026-03-17T10:00:00.000Z",
              },
            ],
          }),
        }),
      }),
    });

    render(await AdminReportsPage());

    expect(mockSessionFrom).not.toHaveBeenCalled();
    expect(mockAdminFrom).toHaveBeenCalledWith("reports");
    expect(screen.getByTestId("reports-client")).toHaveTextContent("1 reports");
    expect(screen.getByText("1 Open")).toBeInTheDocument();
  });

  it("shows the empty state when there are no reports", async () => {
    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    });

    render(await AdminReportsPage());

    expect(screen.getByText("No reports to review.")).toBeInTheDocument();
  });
});
