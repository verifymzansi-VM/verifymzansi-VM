import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockCreateAdminClient, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockRedirect: vi.fn(),
  mockNotFound: vi.fn(),
}));

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
    single: vi.fn().mockResolvedValue({ data, error: data ? null : { message: "not found" } }),
  });
}

describe("governance page regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "gov-1", app_metadata: { role: "governance_controller" } } },
        }),
      },
    });
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
                approved_by: "governance-123456",
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

  it("renders role history using target_user_id and assigned_by fields", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "role_assignments_history") {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "role-1",
                      target_user_id: "user-abcdef12",
                      previous_role: "moderator",
                      new_role: "governance_controller",
                      assigned_by: "admin-fedcba98",
                      reason: "Promotion",
                      created_at: "2026-03-26T08:00:00.000Z",
                    },
                  ],
                }),
              }),
            }),
          };
        }

        if (table === "account_profiles") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                data: [
                  {
                    user_id: "staff-1",
                    display_name: "Gov Controller",
                  },
                ],
              }),
            }),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: {
              users: [
                {
                  id: "staff-1",
                  email: "gov@example.com",
                  updated_at: "2026-03-26T08:30:00.000Z",
                  app_metadata: { role: "governance_controller" },
                  user_metadata: { full_name: "Governance Person" },
                },
              ],
            },
            error: null,
          }),
        },
      },
    });

    render(await GovernanceRolesPage());

    expect(screen.getByText(/Gov Controller/i)).toBeDefined();
    expect(screen.getByText(/Promotion/i)).toBeDefined();
    expect(screen.getAllByText(/^governance_controller$/i)).toHaveLength(2);
    expect(screen.getByText(/gov@example.com/i)).toBeDefined();
    expect(
      screen.getByText((content) => content.includes("Changed by") && content.includes("admin-fe"))
    ).toBeDefined();
  });
});
