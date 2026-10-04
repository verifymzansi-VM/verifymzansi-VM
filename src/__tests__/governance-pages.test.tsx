import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";

const { mockCreateClient, mockCreateAdminClient, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockRedirect: vi.fn(),
  mockNotFound: vi.fn(),
}));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/auth/roles", () => ({
  hasCapability: vi.fn(() => true),
  isAdmin: vi.fn(() => true),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <header>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal();
  const actualIcons =
    actual && typeof actual === "object" ? (actual as Record<string, unknown>) : {};
  return {
    ...actualIcons,
    FileText: () => <span>FileText</span>,
    Loader2: () => <span>Loader2</span>,
    MessageSquare: () => <span>MessageSquare</span>,
    Clock: () => <span>Clock</span>,
    User: () => <span>User</span>,
    UserCog: () => <span>UserCog</span>,
    ShieldAlert: () => <span>ShieldAlert</span>,
    Shield: () => <span>Shield</span>,
    UserPlus: () => <span>UserPlus</span>,
    UserMinus: () => <span>UserMinus</span>,
  };
});

import AppealDetailPage from "@/app/admin/governance/appeals/[id]/page";
import DecisionDetailPage from "@/app/admin/governance/escalations/[id]/page";
import GovernanceRolesPage from "@/app/admin/governance/roles/page";

function createEqSingle(data: Record<string, unknown> | null) {
  return vi.fn().mockReturnValue({
    // A missing row is not an error; the page shows "not found" for it.
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  });
}

describe("governance page regressions", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "gov-1", app_metadata: { role: "governance_controller" } } },
        }),
      },
    });
  });

  it("shows an error, not 'not found', when the appeal cannot be read", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "timeout" } }),
          }),
        }),
      })),
    });

    await expect(AppealDetailPage({ params: Promise.resolve({ id: "appeal-1" }) })).rejects.toThrow(
      "Appeal could not be loaded: timeout"
    );
  });

  it("renders appeal details from the current appeal schema", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "appeal_cases") {
          return {
            select: vi.fn().mockReturnValue({
              eq: createEqSingle({
                id: "appeal-1",
                decision_id: "decision-1",
                status: "under_review",
                created_at: "2026-03-26T10:00:00.000Z",
                appellant_id: "appellant-123456",
                reason: "Evidence was incomplete",
                reviewer_rationale: "Reopened for manual inspection",
                reviewer_id: "reviewer-123456",
                resolved_at: "2026-03-26T12:00:00.000Z",
              }),
            }),
          };
        }

        if (table === "decision_records") {
          return {
            select: vi.fn().mockReturnValue({
              eq: createEqSingle({
                id: "decision-1",
                action_category: "account_suspend",
                status: "approved",
                case_type: "report",
                case_id: "report-1",
                recommendation: "suspend",
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    });

    render(await AppealDetailPage({ params: Promise.resolve({ id: "appeal-1" }) }));

    expect(screen.getByText(/Evidence was incomplete/i)).toBeDefined();
    expect(screen.getByText(/Reopened for manual inspection/i)).toBeDefined();
    expect(screen.getByText(/report:report-1/i)).toBeDefined();
    expect(screen.getByText(/^account_suspend$/i)).toBeDefined();
    expect(screen.getByText(/^suspend$/i)).toBeDefined();
  });

  it("renders escalation detail and event timeline from decision_record_events", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "decision_records") {
          return {
            select: vi.fn().mockReturnValue({
              eq: createEqSingle({
                id: "decision-1",
                action_category: "account_ban",
                status: "approved",
                case_type: "report",
                case_id: "report-77",
                recommender_id: "moderator-123456",
                correlation_id: "corr-123456",
                created_at: "2026-03-26T09:00:00.000Z",
                recommendation: "ban",
                approval_rationale: "Repeated fraud reports",
                approver_id: "governance-123456",
                decided_at: "2026-03-26T11:00:00.000Z",
              }),
            }),
          };
        }

        if (table === "decision_record_events") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "evt-1",
                      event_type: "recommended",
                      detail: { by: "moderator-123456", recommendation: "ban" },
                      created_at: "2026-03-26T09:05:00.000Z",
                    },
                  ],
                }),
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    });

    render(await DecisionDetailPage({ params: Promise.resolve({ id: "decision-1" }) }));

    expect(screen.getByRole("heading", { name: /Decision: account_ban/i })).toBeDefined();
    expect(screen.getByText(/report:report-77/i)).toBeDefined();
    expect(screen.getByText(/Repeated fraud reports/i)).toBeDefined();
    expect(screen.getByText(/\{"by":"moderator-123456","recommendation":"ban"\}/i)).toBeDefined();
  });

  it("renders staff, pending role changes and history from staff_roles and the ledger", async () => {
    staffGuard.as("governance_controller", "gov-1");
    const rows: Record<string, unknown[]> = {
      staff_roles: [
        { user_id: "gov-1", role: "governance_controller", granted_at: "2026-03-01T08:00:00.000Z" },
      ],
      decision_records: [
        {
          id: "decision-1",
          payload: { target_user_id: "new-1", from_role: "member", to_role: "moderator" },
          payload_version: 1,
          recommender_id: "admin-1",
          rationale: "Joining the KYC team",
          created_at: "2026-09-26T08:00:00.000Z",
          expires_at: "2026-10-03T08:00:00.000Z",
        },
        {
          id: "decision-2",
          payload: {
            target_user_id: "gov-2",
            from_role: "member",
            to_role: "governance_controller",
          },
          payload_version: 1,
          recommender_id: "admin-1",
          rationale: "Second governor",
          created_at: "2026-09-26T09:00:00.000Z",
          expires_at: null,
        },
      ],
      role_assignments_history: [
        {
          id: "role-1",
          target_user_id: "gov-1",
          previous_role: "moderator",
          new_role: "governance_controller",
          assigned_by: "admin-1",
          reason: "Promotion",
          created_at: "2026-03-26T08:00:00.000Z",
        },
      ],
      account_profiles: [
        { user_id: "gov-1", display_name: "Gov Controller" },
        { user_id: "admin-1", display_name: "Head Admin" },
      ],
    };
    const directory = vi.fn(async () => ({
      data: [
        { user_id: "gov-1", email: "gov@example.com", display_name: "Gov Controller" },
        { user_id: "admin-1", email: "admin@example.com", display_name: "Head Admin" },
        { user_id: "new-1", email: "newbie@example.com", display_name: null },
      ],
      error: null,
    }));
    const chain = (data: unknown[]) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "in"]) q[m] = vi.fn(() => q);
      q.limit = vi.fn(async () => ({ data, error: null }));
      q.range = vi.fn(async () => ({ data, error: null, count: data.length }));
      q.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
      return q;
    };
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (!(table in rows)) throw new Error(`Unexpected table ${table}`);
        return chain(rows[table]);
      }),
      // Names and emails for everyone on the page, in one call.
      rpc: directory,
    });

    render(await GovernanceRolesPage({}));

    expect(directory).toHaveBeenCalledTimes(1);
    expect(directory).toHaveBeenCalledWith("staff_directory", {
      p_ids: expect.arrayContaining(["gov-1", "new-1", "admin-1"]),
    });
    expect(screen.getByText("1 person")).toBeDefined();
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("role:review");
    expect(screen.getAllByText("Gov Controller").length).toBeGreaterThan(0);
    expect(screen.getByText("newbie@example.com")).toBeDefined();
    expect(screen.getAllByText(/Proposed by Head Admin/)).toHaveLength(2);
    // A governor may approve a moderator grant, but not a governor grant.
    expect(screen.getAllByRole("button", { name: "Approve change" })).toHaveLength(1);
    expect(screen.getByText("An admin must review this change.")).toBeDefined();
    expect(screen.getByText(/By Head Admin — Promotion/)).toBeDefined();
  });
});
