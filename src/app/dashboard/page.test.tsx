import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardPage from "./page";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/account/compat", async () => {
  const actual = await vi.importActual("@/lib/account/compat");

  return {
    ...actual,
    applyOwnerFilter: vi.fn((query) => query),
    getOwnerColumn: vi.fn().mockResolvedValue("owner_id"),
  };
});

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({
    title,
    description,
    children,
  }: {
    title: string;
    description?: string;
    children?: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </div>
  ),
}));

vi.mock("@/components/dashboard/needs-attention", () => ({
  NeedsAttention: ({
    verificationStatus,
    stepsRemaining,
  }: {
    verificationStatus: string;
    stepsRemaining: number;
  }) => <div>{`needs:${verificationStatus}:${stepsRemaining}`}</div>,
}));

vi.mock("@/components/dashboard/stat-chips", () => ({
  StatChips: () => <div>stat-chips</div>,
  defaultChips: () => [],
}));

vi.mock("@/components/dashboard/listing-manager-mini", () => ({
  ListingManagerMini: () => <div>listing-manager-mini</div>,
}));

vi.mock("@/components/dashboard/dashboard-onboarding", () => ({
  DashboardOnboarding: ({
    isVerified,
    hasListings,
    hasBusinesses,
  }: {
    isVerified: boolean;
    hasListings: boolean;
    hasBusinesses: boolean;
  }) => <div>{`dashboard-onboarding:${isVerified}:${hasListings}:${hasBusinesses}`}</div>,
}));

vi.mock("@/components/dashboard/quick-links", () => ({
  QuickLinks: () => <div>quick-links</div>,
}));

vi.mock("@/components/dashboard/email-confirmed-toast", () => ({
  EmailConfirmedToast: () => null,
}));

function createQueryResult(result: { data?: unknown; count?: number | null }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    or: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    gt: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result)),
  };

  return builder;
}

describe("DashboardPage", () => {
  const mockSupabase = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", user_metadata: { display_name: "verifymzansi" } } },
    });

    vi.mocked(createClient).mockResolvedValue(
      mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>
    );
  });

  function stubDashboardQueries({
    profileStatus,
    verificationSteps,
    listings = [],
    activeListingsCount = 0,
    activePromosCount = 0,
    businessCount = 0,
  }: {
    profileStatus: string | null;
    verificationSteps: Array<{ step_type: string; status: string; reviewed_at?: string | null }>;
    listings?: Array<{
      id: string;
      title: string | null;
      status: string;
      area?: string | null;
      photos?: string[] | null;
      view_count?: number | null;
      created_at: string;
      updated_at?: string | null;
    }>;
    activeListingsCount?: number;
    activePromosCount?: number;
    businessCount?: number;
  }) {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return createQueryResult({
          data: {
            id: "profile-1",
            user_id: "user-1",
            display_name: "verifymzansi",
            account_verification_status: profileStatus,
            account_status: "active",
            strikes: 0,
            legal_hold: false,
          },
        });
      }

      if (table === "verification_steps") {
        return createQueryResult({ data: verificationSteps });
      }

      if (table === "listings") {
        return createQueryResult({ data: listings, count: activeListingsCount });
      }

      if (table === "promotions") {
        return createQueryResult({ data: [], count: activePromosCount });
      }

      if (table === "businesses") {
        return createQueryResult({ data: [], count: businessCount });
      }

      if (table === "listing_views") {
        return createQueryResult({ count: 0 });
      }

      return createQueryResult({ data: [], count: 0 });
    });
  }

  it("treats fully approved steps as verified even when the profile status is stale", async () => {
    stubDashboardQueries({
      profileStatus: "incomplete",
      verificationSteps: [
        { step_type: "phone", status: "approved" },
        { step_type: "id_doc", status: "approved", reviewed_at: "2026-04-27T08:00:00.000Z" },
        { step_type: "selfie", status: "approved", reviewed_at: "2026-04-27T08:05:00.000Z" },
        { step_type: "location", status: "approved" },
      ],
    });

    const ui = await DashboardPage();
    render(ui);

    expect(screen.getByText("needs:verified:0")).toBeInTheDocument();
    expect(screen.getAllByText(/Verified/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("dashboard-onboarding:true:false:false")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create Post|Post/i })).toHaveAttribute(
      "href",
      "/post/create"
    );
  });

  it("calculates the real number of steps remaining for incomplete verification", async () => {
    stubDashboardQueries({
      profileStatus: "incomplete",
      verificationSteps: [
        { step_type: "phone", status: "approved" },
        { step_type: "id_doc", status: "approved" },
      ],
    });

    const ui = await DashboardPage();
    render(ui);

    expect(screen.getByText("needs:incomplete:2")).toBeInTheDocument();
    expect(screen.getByText("dashboard-onboarding:false:false:false")).toBeInTheDocument();
    expect(screen.getByText(/2 steps to verify/i)).toBeInTheDocument();
  });

  it("shows the listing manager once the account has content", async () => {
    stubDashboardQueries({
      profileStatus: "verified",
      verificationSteps: [
        { step_type: "phone", status: "approved" },
        { step_type: "id_doc", status: "approved" },
        { step_type: "selfie", status: "approved" },
        { step_type: "location", status: "approved" },
      ],
      listings: [
        {
          id: "listing-1",
          title: "Starter listing",
          status: "live",
          area: "MZANSI_MARKET",
          photos: [],
          view_count: 0,
          created_at: "2026-04-20T00:00:00.000Z",
          updated_at: "2026-04-20T00:00:00.000Z",
        },
      ],
      activeListingsCount: 1,
    });

    const ui = await DashboardPage();
    render(ui);

    expect(screen.getByText("listing-manager-mini")).toBeInTheDocument();
    expect(screen.queryByText(/dashboard-onboarding:/i)).not.toBeInTheDocument();
  });
});
