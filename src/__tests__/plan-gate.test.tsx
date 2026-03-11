/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// Mock Supabase client
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

vi.mock("@/lib/constants/pricing", () => ({
  PLANS: [
    {
      area: "MZANSI_MARKET",
      tier: "starter",
      name: "Starter",
      priceCents: 10000,
      billingFrequency: "30_days",
      features: {
        maxListings: 5,
        maxPhotos: 5,
        videoAllowed: true,
        maxVideos: 1,
        boostAllowed: false,
        featuredAllowed: false,
        urgentAllowed: false,
        coverVideoAllowed: false,
        maxPostsPerMonth: 5,
      },
    },
    {
      area: "MZANSI_MARKET",
      tier: "pro",
      name: "Pro",
      priceCents: 25000,
      billingFrequency: "30_days",
      features: {
        maxListings: 20,
        maxPhotos: 10,
        videoAllowed: true,
        maxVideos: 3,
        boostAllowed: true,
        featuredAllowed: true,
        urgentAllowed: true,
        coverVideoAllowed: true,
        maxPostsPerMonth: 20,
      },
    },
  ],
  TRIAL_CONFIG: { durationDays: 30, tier: "starter", maxListings: 1 },
  FREE_POST_CONFIG: {
    durationDays: 30,
    maxPhotos: 5,
    maxVideos: 1,
    videoAllowed: true,
    maxAllowed: 1,
  },
}));

vi.mock("@/lib/services/entitlements", () => ({
  getEntitlements: vi.fn().mockReturnValue({
    tier: "free",
    isTrial: false,
    trialDaysLeft: 0,
    currentCount: 1,
    maxAllowed: 3,
    maxPhotos: 3,
    videoAllowed: false,
  }),
}));

vi.mock("@/types/enums", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual: typeof import("@/types/enums") = await importOriginal();
  return { ...actual };
});

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { PlanGate } = await import("@/components/billing/plan-gate");

describe("PlanGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    // Mock the from() calls for account_profiles, entitlements, and listings
    mockFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "sp-1", created_at: new Date().toISOString() },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "entitlements") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  gt: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: {
                            tier: "starter",
                            type: "subscription",
                            status: "active",
                            started_at: new Date().toISOString(),
                            expires_at: null,
                          },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "listings" || table === "storefronts" || table === "business_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockResolvedValue({ count: 1, error: null }),
            }),
          }),
        };
      }
      if (table === "free_posts_used") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });
  });

  it("should render children content", async () => {
    render(
      <PlanGate area={"MZANSI_MARKET" as never}>
        <div>Protected Content</div>
      </PlanGate>
    );

    await waitFor(() => {
      expect(screen.getByText("Protected Content")).toBeTruthy();
    });
  });

  it("should render without crashing when user is null", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const { container } = render(
      <PlanGate area={"MZANSI_MARKET" as never}>
        <div>Content</div>
      </PlanGate>
    );

    await waitFor(() => {
      expect(container).toBeTruthy();
    });
  });
});
