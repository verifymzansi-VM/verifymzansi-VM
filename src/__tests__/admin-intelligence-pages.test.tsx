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
    range: vi.fn().mockReturnThis(),
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

  function expectMetric(value: string) {
    expect(screen.getAllByText(value).length).toBeGreaterThan(0);
  }

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

    expectMetric("4");
    expectMetric("7");
    expectMetric("10");
    expectMetric("6");
    expect(mockAdminFrom).not.toHaveBeenCalledWith("kyc_verifications");
    expect(mockAdminFrom).not.toHaveBeenCalledWith("flagged_content");
  });

  it("sums payment revenue from amount_cents", async () => {
    const paymentQueries: Array<ReturnType<typeof createQuery>> = [];

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "invoices") {
        return createQuery({ data: [{ amount_cents: 4350, vat_cents: 650, total_cents: 5000 }] });
      }

      if (table !== "payments") {
        throw new Error(`Unexpected table ${table}`);
      }

      const callCount = mockAdminFrom.mock.calls.length;
      if (callCount === 1) {
        const query = createQuery({ count: 10 });
        paymentQueries.push(query);
        return query;
      }
      if (callCount === 2) {
        const query = createQuery({
          data: [
            { amount_cents: 1250 },
            { amount_cents: 3750 },
            { amount_cents: 0 },
            { amount_cents: 0 },
            { amount_cents: 0 },
            { amount_cents: 0 },
            { amount_cents: 0 },
            { amount_cents: 0 },
          ],
        });
        paymentQueries.push(query);
        return query;
      }
      if (callCount === 3) {
        const query = createQuery({
          data: [
            { amount_cents: 500, status: "failed", area: "MZANSI_MARKET" },
            { amount_cents: 0, status: "failed", area: "MZANSI_MARKET" },
          ],
        });
        paymentQueries.push(query);
        return query;
      }
      const query = createQuery({ data: [] });
      paymentQueries.push(query);
      return query;
    });

    render(await IntelligenceRevenuePage());

    expectMetric("R 50.00");
    expectMetric("10");
    expectMetric("80%");
    expect(paymentQueries[1]?.eq).toHaveBeenCalledWith("status", "complete");
    expect(paymentQueries[2]?.eq).toHaveBeenCalledWith("status", "failed");
    expect(paymentQueries[3]?.eq).toHaveBeenCalledWith("status", "pending");
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
    expectMetric("20");
    expectMetric("5");
    expectMetric("12");
    expectMetric("60% pass rate");
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

    expectMetric("14");
    expectMetric("4");
    expect(screen.getAllByText("6").length).toBeGreaterThanOrEqual(2);
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

    expectMetric("50");
    expectMetric("35");
    expect(screen.getByText("70% of total")).toBeInTheDocument();
    expectMetric("4");
    expectMetric("1");
    expect(mockAdminFrom).not.toHaveBeenCalledWith("profiles");
  });
});
