import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import AdminDSARPage from "./page";

const { mockGetUser, mockSessionFrom, mockAdminFrom, redirectMock, mockVerifyCapability } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockSessionFrom: vi.fn(),
    mockAdminFrom: vi.fn(),
    redirectMock: vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    }),
    mockVerifyCapability: vi.fn(),
  }));

/** Chainable dsar_cases query stub resolving to `result` at `.range()`. */
function dsarQuery(result: { data: unknown[] | null; count?: number | null; error?: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.range = vi.fn().mockResolvedValue({
    data: result.data,
    count: result.count ?? result.data?.length ?? 0,
    error: result.error ?? null,
  });
  return builder;
}

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

vi.mock("@/lib/auth/admin-access", () => ({
  verifyCapabilityFromDb: mockVerifyCapability,
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
  DsarActionButtons: ({
    requestId,
    status,
    requestType,
    identityVerified,
  }: {
    requestId: string;
    status: "submitted" | "in_progress";
    requestType: string;
    identityVerified: boolean;
  }) => (
    <div
      data-testid={`dsar-actions-${requestId}-${status}`}
      data-request-type={requestType}
      data-identity-verified={String(identityVerified)}
    >
      Actions
    </div>
  ),
}));

describe("AdminDSARPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
    });
    mockVerifyCapability.mockResolvedValue(true);
  });

  it("passes case type and identity state to actions for submitted and in-progress requests", async () => {
    const query = dsarQuery({
      data: [
        {
          id: "req-submitted",
          requester_email: "submitted@example.com",
          description: "Submitted request",
          status: "submitted",
          type: "access",
          identity_verified: false,
          created_at: "2026-03-10T10:00:00.000Z",
        },
        {
          id: "req-progress",
          requester_email: "progress@example.com",
          description: "Already in progress",
          status: "in_progress",
          type: "deletion",
          identity_verified: true,
          created_at: "2026-03-10T09:00:00.000Z",
        },
      ],
    });
    mockAdminFrom.mockReturnValue(query);

    render(await AdminDSARPage({ searchParams: Promise.resolve({}) }));

    expect(staffGuard.requireStaff).toHaveBeenCalledWith("dsar:manage");
    expect(mockSessionFrom).not.toHaveBeenCalled();
    expect(mockAdminFrom).toHaveBeenCalledWith("dsar_cases");
    expect(query.in).toHaveBeenCalledWith("status", [
      "submitted",
      "identity_pending",
      "in_progress",
    ]);
    expect(query.order).toHaveBeenCalledWith("due_by", { ascending: true, nullsFirst: true });
    expect(query.range).toHaveBeenCalledWith(0, 24);
    expect(screen.getByText("s***d@example.com")).toBeInTheDocument();
    expect(screen.getByText("p***s@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("dsar-actions-req-submitted-submitted")).toBeInTheDocument();
    expect(screen.getByTestId("dsar-actions-req-progress-in_progress")).toBeInTheDocument();
    expect(screen.getByTestId("dsar-actions-req-submitted-submitted")).toHaveAttribute(
      "data-identity-verified",
      "false"
    );
    expect(screen.getByTestId("dsar-actions-req-progress-in_progress")).toHaveAttribute(
      "data-identity-verified",
      "true"
    );
    expect(screen.getByTestId("dsar-actions-req-progress-in_progress")).toHaveAttribute(
      "data-request-type",
      "deletion"
    );
    expect(screen.getAllByRole("link", { name: /export json/i })).toHaveLength(2);
  });

  it("uses neutral empty-state copy when there are no data requests", async () => {
    mockAdminFrom.mockReturnValue(dsarQuery({ data: [] }));

    render(await AdminDSARPage({ searchParams: Promise.resolve({ view: "closed" }) }));

    expect(screen.getByText("No closed data requests.")).toBeInTheDocument();
  });

  it("lets a governance controller in when the DB confirms dsar:manage", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "gov-1", app_metadata: { role: "governance_controller" } } },
    });
    mockAdminFrom.mockReturnValue(dsarQuery({ data: [] }));

    render(await AdminDSARPage({ searchParams: Promise.resolve({}) }));

    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByText("No open data requests.")).toBeInTheDocument();
  });

  it("redirects staff without dsar:manage", async () => {
    staffGuard.deny("capability");

    await expect(AdminDSARPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(redirectMock).toHaveBeenCalledWith("/admin");
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  it("pages through older cases and shows the total", async () => {
    const query = dsarQuery({ data: [], count: 60 });
    mockAdminFrom.mockReturnValue(query);

    render(await AdminDSARPage({ searchParams: Promise.resolve({ page: "3" }) }));

    expect(query.range).toHaveBeenCalledWith(50, 74);
    expect(screen.getByText(/60 open requests · Page 3 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/admin/dsar?view=open&page=2"
    );
  });

  it("shows an error instead of an empty state when the read fails", async () => {
    mockAdminFrom.mockReturnValue(dsarQuery({ data: null, error: { message: "boom" } }));

    render(await AdminDSARPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
  });
});
