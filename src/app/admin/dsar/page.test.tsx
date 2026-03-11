import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminDSARPage from "./page";

const { mockGetUser, mockFrom, redirectMock } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
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

vi.mock("./dsar-action-buttons", () => ({
  DsarActionButtons: ({ requestId }: { requestId: string }) => (
    <div data-testid={`dsar-actions-${requestId}`}>Actions</div>
  ),
}));

describe("AdminDSARPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
    });
  });

  it("only renders action buttons for submitted requests", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                id: "req-submitted",
                requester_email: "submitted@example.com",
                description: "Submitted request",
                status: "submitted",
                type: "access",
                created_at: "2026-03-10T10:00:00.000Z",
              },
              {
                id: "req-progress",
                requester_email: "progress@example.com",
                description: "Already in progress",
                status: "in_progress",
                type: "delete",
                created_at: "2026-03-10T09:00:00.000Z",
              },
            ],
          }),
        }),
      }),
    });

    render(await AdminDSARPage());

    expect(screen.getByTestId("dsar-actions-req-submitted")).toBeInTheDocument();
    expect(screen.queryByTestId("dsar-actions-req-progress")).not.toBeInTheDocument();
  });

  it("uses neutral empty-state copy when there are no data requests", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    });

    render(await AdminDSARPage());

    expect(screen.getByText("No data requests found.")).toBeInTheDocument();
  });
});
