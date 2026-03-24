import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminAuditLogPage from "./page";

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
  isAdmin: vi.fn(() => true),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

describe("AdminAuditLogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
    });
  });

  it("reads audit logs through the admin client after auth gating", async () => {
    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                id: "log-1",
                action: "dsar_completed",
                actor_id: "admin-1",
                target_type: "dsar_case",
                metadata: { requestId: "req-1" },
                created_at: "2026-03-17T10:00:00.000Z",
              },
            ],
          }),
        }),
      }),
    });

    render(await AdminAuditLogPage());

    expect(mockSessionFrom).not.toHaveBeenCalled();
    expect(mockAdminFrom).toHaveBeenCalledWith("audit_logs");
    expect(screen.getByText("dsar_completed")).toBeInTheDocument();
    expect(screen.getByText(/admin-1/i)).toBeInTheDocument();
  });

  it("shows the empty state when there are no audit entries", async () => {
    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    });

    render(await AdminAuditLogPage());

    expect(screen.getByText("No audit entries recorded yet.")).toBeInTheDocument();
  });
});
