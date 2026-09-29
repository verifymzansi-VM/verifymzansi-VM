import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import AdminDSARPage from "./page";

const { mockAdminFrom, redirectMock } = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

type Result = { data: unknown; count?: number | null; error?: unknown };
type Builder = Record<string, ReturnType<typeof vi.fn>> & PromiseLike<Result>;

/**
 * Chainable query stub. `.range()` resolves the case list; awaiting the
 * builder directly resolves head counts and the deadline rules.
 */
function query(result: Result): Builder {
  const settled = { data: result.data, count: result.count ?? null, error: result.error ?? null };
  const builder = {} as Builder;
  for (const m of ["select", "in", "eq", "lt", "gte", "order"]) builder[m] = vi.fn(() => builder);
  builder.range = vi.fn().mockResolvedValue(settled);
  builder.then = ((resolve: (r: Result) => unknown) =>
    Promise.resolve(settled).then(resolve)) as Builder["then"];
  return builder;
}

const RULES = [
  { request_type: "access", extension_days: 30, statutory: true },
  { request_type: "deletion", extension_days: 0, statutory: false },
];

/** Wire the page's reads: cases list, overdue count, due-soon count, rules, assignees. */
function tables({
  cases,
  count,
  overdue = 0,
  dueSoon = 0,
  error,
}: {
  cases: unknown[] | null;
  count?: number;
  overdue?: number;
  dueSoon?: number;
  error?: unknown;
}) {
  const casesQuery = query({ data: cases, count: count ?? cases?.length ?? 0, error });
  const dsarQueries = [
    casesQuery,
    query({ data: null, count: overdue }),
    query({ data: null, count: dueSoon }),
  ];
  let dsarCall = 0;
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "dsar_cases") return dsarQueries[dsarCall++] ?? query({ data: null, count: 0 });
    if (table === "dsar_deadline_rules") return query({ data: RULES });
    if (table === "account_profiles")
      return query({ data: [{ user_id: "gov-2", display_name: "Thandi" }] });
    throw new Error(`unexpected table ${table}`);
  });
  return casesQuery;
}

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mockAdminFrom })),
}));

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
  created_at: inDays(-5),
  received_at: inDays(-5),
  legal_basis: "Access request: PAIA s25",
  extended_due_at: null,
  extension_reason: null,
  extension_notified_at: null,
  assigned_to: null,
};

describe("AdminDSARPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
  });

  it("lists open cases by the deadline that applies now, with basis and assignee", async () => {
    const casesQuery = tables({
      cases: [
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
          legal_basis: "Internal target: POPIA s24",
        },
      ],
      overdue: 1,
    });

    render(await AdminDSARPage({ searchParams: Promise.resolve({}) }));

    expect(staffGuard.requireStaff).toHaveBeenCalledWith("dsar:manage");
    expect(casesQuery.in).toHaveBeenCalledWith("status", [
      "submitted",
      "identity_pending",
      "in_progress",
    ]);
    expect(casesQuery.order).toHaveBeenCalledWith("effective_due_at", { ascending: true });
    expect(casesQuery.range).toHaveBeenCalledWith(0, 24);

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
    tables({
      cases: [
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

  it("filters the overdue, due-soon and mine views", async () => {
    let q = tables({ cases: [] });
    render(await AdminDSARPage({ searchParams: Promise.resolve({ view: "overdue" }) }));
    expect(q.lt).toHaveBeenCalledWith("effective_due_at", expect.any(String));

    q = tables({ cases: [] });
    render(await AdminDSARPage({ searchParams: Promise.resolve({ view: "due_soon" }) }));
    expect(q.gte).toHaveBeenCalledWith("effective_due_at", expect.any(String));
    expect(q.lt).toHaveBeenCalledWith("effective_due_at", expect.any(String));

    q = tables({ cases: [] });
    render(await AdminDSARPage({ searchParams: Promise.resolve({ view: "mine" }) }));
    expect(q.eq).toHaveBeenCalledWith("assigned_to", "staff-1");
  });

  it("shows closed cases newest first with a neutral empty state", async () => {
    const q = tables({ cases: [] });

    render(await AdminDSARPage({ searchParams: Promise.resolve({ view: "closed" }) }));

    expect(q.in).toHaveBeenCalledWith("status", ["completed", "rejected"]);
    expect(q.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(screen.getByText("No data requests in this view.")).toBeInTheDocument();
  });

  it("lets a governance controller in", async () => {
    staffGuard.as("governance_controller", "gov-1");
    tables({ cases: [] });

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
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  it("pages through older cases and shows the total", async () => {
    const q = tables({ cases: [], count: 60 });

    render(await AdminDSARPage({ searchParams: Promise.resolve({ page: "3" }) }));

    expect(q.range).toHaveBeenCalledWith(50, 74);
    expect(screen.getByText(/60 requests · Page 3 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/admin/dsar?view=open&page=2"
    );
  });

  it("shows an error instead of an empty state when the read fails", async () => {
    tables({ cases: null, error: { message: "boom" } });

    render(await AdminDSARPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
  });
});
