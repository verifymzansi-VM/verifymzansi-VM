import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { getOptionalContentViewCountMap } from "@/lib/engagement-server";
vi.mock("@/lib/foundation/server-session", () => {
  const readFoundationServerSession = vi.fn();
  return {
    readFoundationServerSession,
    readFoundationServerUser: vi.fn(async () => (await readFoundationServerSession()).user),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: vi.fn(() => ({ rpc: vi.fn() })),
}));

vi.mock("@/lib/engagement-server", () => ({
  getOptionalContentViewCountMap: vi.fn(
    (_admin: unknown, _targetType: string, targetIds: string[]) => ({
      ok: true,
      data: new Map(targetIds.map((targetId) => [targetId, targetId === "listing-1" ? 23 : 0])),
    })
  ),
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
  ListingManagerMini: ({
    posts,
  }: {
    posts: Array<{ title: string | null; view_count?: number | null }>;
  }) => (
    <div>
      listing-manager-mini
      {posts.map((post) => (
        <span key={post.title ?? "untitled"}>{`${post.title}:${post.view_count ?? 0}`}</span>
      ))}
    </div>
  ),
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

vi.mock("@/components/dashboard/dashboard-live-lead-alerts", () => ({
  DashboardLiveLeadAlerts: ({
    liveListings,
    businesses,
    activePromos,
    verificationStatus,
    stepsRemaining,
  }: {
    liveListings: number;
    businesses: number;
    activePromos: number;
    verificationStatus: string;
    stepsRemaining: number;
  }) => (
    <div>
      <div>{`stats:${liveListings}:${businesses}:${activePromos}`}</div>
      <div>{`needs:${verificationStatus}:${stepsRemaining}`}</div>
    </div>
  ),
}));

function createQueryResult(result: { data?: unknown; count?: number | null }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    or: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    is: vi.fn(() => builder),
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

  it("renders canonical owner data without querying retired tables or fabricating view counts", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
    const owner = "11111111-1111-4111-8111-111111111111";
    const at = "2026-11-03T12:00:00Z";
    const user = {
      id: owner,
      created_at: at,
      email_confirmed_at: at,
      user_metadata: { display_name: "Metadata Name" },
    };
    const profile = {
      display_name: "Canonical Member",
      public_name: "Canonical Member",
      bio: null,
      avatar_object_id: null,
      legal_first_name: null,
      legal_last_name: null,
      legal_name_locked: false,
      identity_verified: false,
      revision: 1,
      updated_at: at,
    };
    const snapshot = {
      version: 1,
      account_id: owner,
      generated_at: at,
      verification: {
        case_id: null,
        version: null,
        verified: false,
        phone_verified: true,
        locality_confirmed: false,
        submission_pending: false,
        return_reason: null,
      },
      profile_facts: {
        legal_name_locked_at: null,
        phone_changed_at: null,
        phone_verified_at: at,
        identity_reviewed_at: null,
        location_province: null,
        location_city: null,
        location_confirmed_at: null,
      },
      counts: {
        active_listings: 2,
        active_events: 5,
        rejected_listings: 0,
        pending_listings: 0,
        expiring_listings: 0,
        expiring_events: 0,
        businesses: 3,
        tourism_businesses: 4,
      },
      unread_leads: 0,
      unread_notifications: 0,
      organisation_admin_count: 0,
      posts: [1, 2].map((n) => ({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`,
        title: `Native ${n}`,
        status: "live",
        created_at: at,
        updated_at: at,
        expires_at: "2026-12-03T12:00:00Z",
        area: "MZANSI_MARKET",
        cover_object_key: null,
      })),
      recent_leads: [],
      paid_plans: [],
    };
    const rpc = vi.fn().mockImplementation(async (name: string) => {
      if (name === "get_my_dashboard") return { data: snapshot, error: null };
      if (name === "get_my_frontend_identity_state")
        return {
          data: {
            account_id: owner,
            case_id: null,
            case_version: null,
            reason: null,
            decision: null,
            identity_reviewed_at: null,
            id_document_uploaded_at: null,
            selfie_uploaded_at: null,
          },
          error: null,
        };
      throw new Error(`Unexpected native dashboard command: ${name}`);
    });
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user } });
    vi.mocked(readFoundationServerSession).mockResolvedValue({
      user,
      account: { account_id: owner, phone: "+27820000000", profile, staff: null },
      api: { rpc },
    } as unknown as Awaited<ReturnType<typeof readFoundationServerSession>>);
    try {
      render(await DashboardPage({ searchParams: Promise.resolve({}) }));
      expect(screen.getByText("Canonical", { exact: false })).toBeInTheDocument();
      expect(screen.getByText("stats:2:3:9")).toBeInTheDocument();
      expect(mockSupabase.from).not.toHaveBeenCalled();
      // The account comes from the one verified session, not another Auth call.
      expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
      expect(getOptionalContentViewCountMap).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledWith("get_my_dashboard", {}, { get: false });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  function stubDashboardQueries({
    profileStatus,
    verificationSteps,
    listings = [],
    activeListingsCount = 0,
    activePromosCount = 0,
    businessCount = 0,
    tourismBusinessCount = 0,
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
    tourismBusinessCount?: number;
  }) {
    let businessQueryCount = 0;
    const businessQueries: Array<ReturnType<typeof createQueryResult>> = [];

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
        businessQueryCount += 1;
        const query = createQueryResult({
          data: [],
          count: businessQueryCount === 1 ? businessCount : tourismBusinessCount,
        });
        businessQueries.push(query);
        return query;
      }

      if (table === "listing_views") {
        return createQueryResult({ count: 0 });
      }

      return createQueryResult({ data: [], count: 0 });
    });

    return { businessQueries };
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

    const ui = await DashboardPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("needs:verified:0")).toBeInTheDocument();
    expect(screen.getAllByText(/Verified/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("dashboard-onboarding:true:false:false")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new post/i })).toHaveAttribute("href", "/post/create");
    // Verified members get a badge, not the verification prompt card.
    expect(screen.queryByTestId("dashboard-verification-card")).not.toBeInTheDocument();
  });

  it("calculates the real number of steps remaining for incomplete verification", async () => {
    stubDashboardQueries({
      profileStatus: "incomplete",
      verificationSteps: [
        { step_type: "phone", status: "approved" },
        { step_type: "id_doc", status: "approved" },
      ],
    });

    const ui = await DashboardPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("needs:incomplete:2")).toBeInTheDocument();
    expect(screen.getByText("dashboard-onboarding:false:false:false")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /2 steps to verify/i })).toBeInTheDocument();
    // The next step is named and linked.
    expect(screen.getByText(/Next: take a selfie/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue verification" })).toHaveAttribute(
      "href",
      "/verification"
    );
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

    const ui = await DashboardPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("listing-manager-mini")).toBeInTheDocument();
    expect(screen.getByText("Starter listing:23")).toBeInTheDocument();
    expect(screen.queryByText(/dashboard-onboarding:/i)).not.toBeInTheDocument();
  });

  it("counts tourism businesses under Tourism & Events instead of Businesses", async () => {
    const { businessQueries } = stubDashboardQueries({
      profileStatus: "verified",
      verificationSteps: [
        { step_type: "phone", status: "approved" },
        { step_type: "id_doc", status: "approved" },
        { step_type: "selfie", status: "approved" },
        { step_type: "location", status: "approved" },
      ],
      businessCount: 0,
      tourismBusinessCount: 1,
    });

    const ui = await DashboardPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("stats:0:0:1")).toBeInTheDocument();
    expect(screen.queryByText("dashboard-onboarding:true:false:false")).not.toBeInTheDocument();
    expect(businessQueries[0].neq).toHaveBeenCalledWith("category", "tourism_hospitality");
    expect(businessQueries[0].or).toHaveBeenCalledWith("area.is.null,area.neq.PROMOTIONS_EVENTS");
    expect(businessQueries[1].or).toHaveBeenCalledWith(
      "area.eq.PROMOTIONS_EVENTS,category.eq.tourism_hospitality"
    );
  });
});
