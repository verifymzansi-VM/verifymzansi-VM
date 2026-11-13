import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import AdminDSARPage from "./page";

const { readQueue, redirectMock } = vi.hoisted(() => ({
  readQueue: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const RULES = [
  { request_type: "access", extension_days: 30, statutory: true },
  { request_type: "correction", extension_days: 0, statutory: true },
  { request_type: "deletion", extension_days: 0, statutory: false },
  { request_type: "objection", extension_days: 0, statutory: true },
];

/** The staff privacy queue the database returns for one view and page. */
function queue({
  items,
  total,
  overdue = 0,
  dueSoon = 0,
}: {
  items: unknown[];
  total?: number;
  overdue?: number;
  dueSoon?: number;
}) {
  readQueue.mockResolvedValue({
    actor_id: "staff-1",
    items,
    total: total ?? items.length,
    overdue,
    due_soon: dueSoon,
    rules: RULES,
  });
}

vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: vi.fn(async () => ({ api: { fixture: "api" } })),
}));
vi.mock("@/lib/foundation/privacy-requests", () => ({ readFrontendPrivacyQueue: readQueue }));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("./dsar-action-buttons", () => ({
  DsarActionButtons: ({
    requestId,
    status,
    identityVerified,
  }: {
    requestId: string;
    status: string;
    identityVerified: boolean;
  }) => (
    <div
      data-testid={`dsar-actions-${requestId}-${status}`}
      data-identity-verified={String(identityVerified)}
    />
  ),
}));

vi.mock("./dsar-case-controls", () => ({
  DsarCaseControls: (props: { requestId: string; canExtend: boolean; isOpen: boolean }) => (
    <div
      data-testid={`dsar-controls-${props.requestId}`}
      data-can-extend={String(props.canExtend)}
      data-open={String(props.isOpen)}
    />
  ),
}));

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

const baseCase = {
  requester_email: "subject@example.com",
  description: "Please send my data",
  identity_check: "session",
  revision: 1,
  created_at: inDays(-5),
  received_at: inDays(-5),
  legal_basis: "Access request: PAIA s25",
  extended_due_at: null,
  extension_reason: null,
  extension_notified_at: null,
  assigned_to: null,
  assignee_name: null,
  response_summary: null,
  completed_at: null,
  may_process: true,
};

describe("AdminDSARPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
  });

  it("lists open cases by the deadline that applies now, with basis and assignee", async () => {
    queue({
      items: [
        {
          ...baseCase,
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          type: "access",
          status: "submitted",
          identity_verified: false,
          due_by: inDays(-1),
          effective_due_at: inDays(-1),
        },
        {
          ...baseCase,
          id: "bbbbbbbb-0000-4000-8000-000000000002",
          type: "deletion",
          status: "in_progress",
          identity_verified: true,
          due_by: inDays(20),
          effective_due_at: inDays(20),
          assigned_to: "gov-2",
          assignee_name: "Thandi",
          legal_basis: "Internal target: POPIA s24",
        },
      ],
      overdue: 1,
    });

    render(await AdminDSARPage({ searchParams: Promise.resolve({}) }));

    expect(staffGuard.requireStaff).toHaveBeenCalledWith("dsar:manage");
    expect(readQueue).toHaveBeenCalledWith({ fixture: "api" }, "staff-1", "open", 1);

    expect(screen.getByText(/Overdue since/)).toBeInTheDocument();
    expect(screen.getByText(/Assigned to Thandi/)).toBeInTheDocument();
    expect(screen.getByText(/Internal target: POPIA s24 \(internal target\)/)).toBeInTheDocument();
    expect(
      screen.getByTestId("dsar-actions-aaaaaaaa-0000-4000-8000-000000000001-submitted")
    ).toHaveAttribute("data-identity-verified", "false");
    // Overdue access requests cannot be extended; deletions never can.
    expect(
      screen.getByTestId("dsar-controls-aaaaaaaa-0000-4000-8000-000000000001")
    ).toHaveAttribute("data-can-extend", "false");
    expect(
      screen.getByTestId("dsar-controls-bbbbbbbb-0000-4000-8000-000000000002")
    ).toHaveAttribute("data-can-extend", "false");
    expect(screen.getByRole("link", { name: /Overdue\s*1/ })).toBeInTheDocument();
  });

  it("offers an extension only for an access request that is not yet due or extended", async () => {
    queue({
      items: [
        {
          ...baseCase,
          id: "cccccccc-0000-4000-8000-000000000003",
          type: "access",
          status: "in_progress",
          identity_verified: true,
          due_by: inDays(10),
          effective_due_at: inDays(10),
        },
      ],
    });

    render(await AdminDSARPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByTestId("dsar-controls-cccccccc-0000-4000-8000-000000000003")
    ).toHaveAttribute("data-can-extend", "true");
  });

  it.each(["overdue", "due_soon", "mine", "closed"])("reads the %s view", async (view) => {
    queue({ items: [] });

    render(await AdminDSARPage({ searchParams: Promise.resolve({ view }) }));

    expect(readQueue).toHaveBeenCalledWith({ fixture: "api" }, "staff-1", view, 1);
    expect(screen.getByText("No data requests in this view.")).toBeInTheDocument();
  });

  it("lets a governance controller in", async () => {
    staffGuard.as("governance_controller", "gov-1");
    queue({ items: [] });

    render(await AdminDSARPage({ searchParams: Promise.resolve({}) }));

    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Record a request/ })).toHaveAttribute(
      "href",
      "/admin/dsar/new"
    );
  });

  it("redirects staff without dsar:manage", async () => {
    staffGuard.deny("capability");

    await expect(AdminDSARPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(redirectMock).toHaveBeenCalledWith("/admin");
    expect(readQueue).not.toHaveBeenCalled();
  });

  it("pages through older cases and shows the total", async () => {
    queue({ items: [], total: 60 });

    render(await AdminDSARPage({ searchParams: Promise.resolve({ page: "3" }) }));

    expect(readQueue).toHaveBeenCalledWith({ fixture: "api" }, "staff-1", "open", 3);
    expect(screen.getByText(/60 requests · Page 3 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/admin/dsar?view=open&page=2"
    );
  });

  it("shows an error instead of an empty state when the read fails", async () => {
    readQueue.mockRejectedValue(new Error("boom"));

    render(await AdminDSARPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
  });

  it("sends staff to the two-step check when the database asks for it", async () => {
    readQueue.mockRejectedValue(
      new FoundationStaffCommandError(403, "Authenticator required", true)
    );

    await expect(
      AdminDSARPage({ searchParams: Promise.resolve({ view: "mine", page: "2" }) })
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith(expect.stringMatching(/^\/staff\/two-step/));
  });
});
