import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockCreateAdminClient, mockRedirect, mockHasCapability, mockAdminFrom } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockRedirect: vi.fn(),
    mockHasCapability: vi.fn(() => true),
    mockAdminFrom: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/auth/roles", () => ({
  hasCapability: mockHasCapability,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
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

vi.mock("lucide-react", () => ({
  ShoppingBag: () => <span>ShoppingBag</span>,
  Package: () => <span>Package</span>,
  Store: () => <span>Store</span>,
  TrendingUp: () => <span>TrendingUp</span>,
  Clock: () => <span>Clock</span>,
  Flag: () => <span>Flag</span>,
  ShieldCheck: () => <span>ShieldCheck</span>,
  Activity: () => <span>Activity</span>,
  DollarSign: () => <span>DollarSign</span>,
  CreditCard: () => <span>CreditCard</span>,
  ArrowUpRight: () => <span>ArrowUpRight</span>,
  CheckCircle: () => <span>CheckCircle</span>,
  XCircle: () => <span>XCircle</span>,
  Calendar: () => <span>Calendar</span>,
  BarChart3: () => <span>BarChart3</span>,
  Users: () => <span>Users</span>,
  UserPlus: () => <span>UserPlus</span>,
}));

import IntelligenceMarketplacePage from "@/app/admin/intelligence/marketplace/page";
import IntelligenceOperationsPage from "@/app/admin/intelligence/operations/page";
import IntelligenceRevenuePage from "@/app/admin/intelligence/revenue/page";
import IntelligenceTrendsPage from "@/app/admin/intelligence/trends/page";
import IntelligenceUsersPage from "@/app/admin/intelligence/users/page";
import IntelligenceVerificationPage from "@/app/admin/intelligence/verification/page";

type QueryResult = { data?: unknown[] | null; count?: number | null };

function createQuery(result: QueryResult) {
  const promise = Promise.resolve(result);

  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };

  return builder;
}

describe("admin intelligence page regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
        }),
      },
    });

    mockCreateAdminClient.mockReturnValue({
      from: mockAdminFrom,
    });
  });

  it("uses the real listings and promotions tables for marketplace metrics", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      switch (table) {
        case "listings":
          return createQuery({
            count:
              mockAdminFrom.mock.calls.filter(([name]) => name === "listings").length === 1
                ? 42
                : 30,
          });
        case "businesses":
          return createQuery({ count: 12 });
        case "promotions":
          return createQuery({ count: 9 });
        default:
          throw new Error(`Unexpected table ${table}`);
      }
    });

    render(await IntelligenceMarketplacePage());

    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("30 live")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Live Promotions" })).toBeInTheDocument();
    expect(mockAdminFrom).not.toHaveBeenCalledWith("market_listings");
  });

  it("aggregates moderation and verification queues from schema-backed tables", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      switch (table) {
        case "reports":
          return createQuery({ count: 4 });
        case "verification_steps":
          return createQuery({ count: 7 });
        case "listings":
          return createQuery({ count: 2 });
        case "businesses":
          return createQuery({ count: 3 });
        case "promotions":
          return createQuery({ count: 5 });
        case "decision_records":
          return createQuery({ count: 6 });
        default:
          throw new Error(`Unexpected table ${table}`);
      }
    });

    render(await IntelligenceOperationsPage());

    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(mockAdminFrom).not.toHaveBeenCalledWith("kyc_verifications");
    expect(mockAdminFrom).not.toHaveBeenCalledWith("flagged_content");
  });

  it("sums payment revenue from amount_cents", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table !== "payments") {
        throw new Error(`Unexpected table ${table}`);
      }

      const callCount = mockAdminFrom.mock.calls.length;
      if (callCount === 1) {
        return createQuery({ count: 10 });
      }
      if (callCount === 2) {
        return createQuery({ data: [{ amount_cents: 1250 }, { amount_cents: 3750 }] });
      }
      return createQuery({ count: 2 });
    });

    render(await IntelligenceRevenuePage());

    expect(screen.getByText("R 50.00")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("reads verification metrics from verification_steps", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table !== "verification_steps") {
        throw new Error(`Unexpected table ${table}`);
      }

      const callCount = mockAdminFrom.mock.calls.length;
      return createQuery({ count: [20, 5, 12, 3][callCount - 1] ?? 0 });
    });

    render(await IntelligenceVerificationPage());

    expect(screen.getByRole("heading", { name: "Total Verification Steps" })).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("60% pass rate")).toBeInTheDocument();
    expect(mockAdminFrom).not.toHaveBeenCalledWith("kyc_verifications");
  });

  it("uses account profiles and content tables for trend analysis", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      switch (table) {
        case "account_profiles":
          return createQuery({
            count:
              mockAdminFrom.mock.calls.filter(([name]) => name === "account_profiles").length === 1
                ? 14
                : 4,
          });
        case "verification_steps":
          return createQuery({ count: 6 });
        case "listings":
          return createQuery({ count: 3 });
        case "businesses":
          return createQuery({ count: 2 });
        case "promotions":
          return createQuery({ count: 1 });
        default:
          throw new Error(`Unexpected table ${table}`);
      }
    });

    render(await IntelligenceTrendsPage());

    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getAllByText("6")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Content Posted (30d)" })).toBeInTheDocument();
    expect(mockAdminFrom).not.toHaveBeenCalledWith("profiles");
    expect(mockAdminFrom).not.toHaveBeenCalledWith("posts");
  });

  it("reads user metrics from account_profiles statuses", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table !== "account_profiles") {
        throw new Error(`Unexpected table ${table}`);
      }

      const callCount = mockAdminFrom.mock.calls.length;
      return createQuery({ count: [50, 35, 4, 1][callCount - 1] ?? 0 });
    });

    render(await IntelligenceUsersPage());

    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getByText("70% of total")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(mockAdminFrom).not.toHaveBeenCalledWith("profiles");
  });
});
