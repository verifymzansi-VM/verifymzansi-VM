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

import DecisionDetailPage from "@/app/admin/governance/escalations/[id]/page";

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
});
