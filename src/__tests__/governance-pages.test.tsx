import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";

const { readRestoredGovernancePage, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  readRestoredGovernancePage: vi.fn(),
  mockRedirect: vi.fn(),
  mockNotFound: vi.fn(),
}));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);

vi.mock("@/lib/foundation/governance-server", () => ({ readRestoredGovernancePage }));

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

describe("governance page regressions", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
  });

  it("renders escalation detail and its event timeline", async () => {
    readRestoredGovernancePage.mockResolvedValue([
      {
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
        payload_version: 1,
        execution_status: null,
        timeline: [
          {
            id: "evt-1",
            event_type: "recommended",
            detail: { by: "moderator-123456", recommendation: "ban" },
            created_at: "2026-03-26T09:05:00.000Z",
          },
        ],
      },
    ]);

    render(await DecisionDetailPage({ params: Promise.resolve({ id: "decision-1" }) }));

    expect(screen.getByRole("heading", { name: /Decision: account_ban/i })).toBeDefined();
    expect(screen.getByText(/report:report-77/i)).toBeDefined();
    expect(screen.getByText(/Repeated fraud reports/i)).toBeDefined();
    expect(screen.getByText(/\{"by":"moderator-123456","recommendation":"ban"\}/i)).toBeDefined();
    expect(readRestoredGovernancePage).toHaveBeenCalledWith(1, "decision-1");
  });
});
