import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { getOptionalContentViewCountMap } from "@/lib/engagement-server";
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
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
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Canonical", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("stats:2:3:9")).toBeInTheDocument();
    expect(screen.getByText("listing-manager-mini")).toBeInTheDocument();
    expect(screen.getByText("Native 1:0")).toBeInTheDocument();
    expect(screen.queryByText(/dashboard-onboarding:/)).not.toBeInTheDocument();
    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(getOptionalContentViewCountMap).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("get_my_dashboard", {}, { get: false });
  });
});
