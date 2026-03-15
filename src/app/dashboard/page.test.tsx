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
  PageHeader: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("@/components/dashboard/attention-banner", () => ({
  AttentionBanner: ({
    verificationStatus,
    stepsRemaining,
  }: {
    verificationStatus: string;
    stepsRemaining: number;
  }) => <div>{`attention:${verificationStatus}:${stepsRemaining}`}</div>,
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

vi.mock("@/components/trust/trust-badge", () => ({
  TrustBadge: ({ level }: { level: number }) => <div>{`trust:${level}`}</div>,
}));

vi.mock("@/components/trust/verification-progress", () => ({
  VerificationProgress: ({ steps }: { steps: Array<{ type: string; status: string }> }) => (
    <div>{`progress:${steps.length}`}</div>
  ),
}));

vi.mock("@/components/dashboard/recent-activity", () => ({
  RecentActivity: () => <div>recent-activity</div>,
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
  }: {
    profileStatus: string | null;
    verificationSteps: Array<{ step_type: string; status: string }>;
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
        { step_type: "id_doc", status: "approved" },
        { step_type: "selfie", status: "approved" },
        { step_type: "location", status: "approved" },
      ],
    });

    const ui = await DashboardPage();
    render(ui);

    expect(screen.getByText("attention:verified:0")).toBeInTheDocument();
    expect(screen.queryByText(/needs:/)).not.toBeInTheDocument();
    expect(screen.getByText("trust:3")).toBeInTheDocument();
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

    expect(screen.getByText("attention:incomplete:2")).toBeInTheDocument();
    expect(screen.getByText("needs:incomplete:2")).toBeInTheDocument();
  });
});
