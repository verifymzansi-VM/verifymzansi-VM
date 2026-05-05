/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/post/create-listing",
}));

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

const mockWithCsrfHeaders = vi.fn((headers?: HeadersInit) => {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("x-csrf-token", "a".repeat(64));
  return nextHeaders;
});

vi.mock("@/lib/utils/csrf", () => ({
  withCsrfHeaders: (headers?: HeadersInit) => mockWithCsrfHeaders(headers),
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
  getPlanCheckoutId: (plan: { tier: string; area: string }) => `${plan.area}-${plan.tier}`,
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

vi.mock("@/lib/account/compat", () => ({
  getOwnerColumn: vi.fn().mockResolvedValue("owner_id"),
  OWNER_COMPAT_TABLES: ["listings", "businesses", "promotions", "leads", "contact_events"],
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { PlanGate } = await import("@/components/billing/plan-gate");

function createCountQuery(count: number, eqCalls?: Array<{ column: string; value: unknown }>) {
  const query = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls?.push({ column, value });
      return query;
    }),
    neq: vi.fn().mockResolvedValue({ count, error: null }),
  };

  return {
    select: vi.fn().mockReturnValue(query),
  };
}

describe("PlanGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ checkoutUrl: "https://checkout.example.test" }),
      })
    );
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
      if (
        table === "listings" ||
        table === "storefronts" ||
        table === "business_profiles" ||
        table === "businesses" ||
        table === "promotions"
      ) {
        return createCountQuery(0);
      }
      if (table === "free_posts_used") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ count: 0, error: null }),
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

  it("sends signed-in users without a profile to phone setup with a returnUrl", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }

      return {};
    });

    render(
      <PlanGate area={"MZANSI_MARKET" as never}>
        <div>Protected Content</div>
      </PlanGate>
    );

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /add phone number/i })).toHaveAttribute(
        "href",
        "/dashboard/complete-profile?returnUrl=%2Fpost%2Fcreate-listing"
      );
    });
  });

  it("starts checkout with CSRF headers when choosing a paid plan", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "http://localhost/post/create-listing" },
    });

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
                          data: null,
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
      if (table === "listings") {
        return createCountQuery(0);
      }
      if (table === "free_posts_used") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ count: 1, error: null }),
              }),
            }),
          }),
        };
      }

      return {};
    });

    render(
      <PlanGate area={"MZANSI_MARKET" as never}>
        <div>Protected Content</div>
      </PlanGate>
    );

    await screen.findByRole("button", { name: /choose starter/i });
    fireEvent.click(screen.getByRole("button", { name: /choose starter/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [url, requestInit] = vi.mocked(global.fetch).mock.calls[0] ?? [];

    expect(url).toBe("/api/billing/create-checkout");
    expect(requestInit).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.any(Headers),
      })
    );
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      planId: expect.any(String),
    });
    expect(mockWithCsrfHeaders).toHaveBeenCalledWith({ "Content-Type": "application/json" });
    expect(window.location.href).toBe("https://checkout.example.test");

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("shows the free-post trial state when one free post remains", async () => {
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
                          data: null,
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
      if (table === "listings") {
        return createCountQuery(0);
      }
      if (table === "free_posts_used") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ count: 0, error: null }),
              }),
            }),
          }),
        };
      }

      return {};
    });

    render(
      <PlanGate area={"MZANSI_MARKET" as never}>
        <div>Protected Content</div>
      </PlanGate>
    );

    await waitFor(() => {
      expect(screen.getByText(/1\/1 free post left/i)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /use your free post/i })).toBeTruthy();
    expect(screen.queryByText(/used your free post/i)).toBeNull();
  });

  it("keeps tourism business rows from consuming the Mzansi Business gate", async () => {
    const businessCountEqCalls: Array<{ column: string; value: unknown }> = [];

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
                          data: null,
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
      if (table === "businesses") {
        return createCountQuery(0, businessCountEqCalls);
      }
      if (table === "free_posts_used") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ count: 0, error: null }),
              }),
            }),
          }),
        };
      }

      return {};
    });

    render(
      <PlanGate area={"MZANSI_BUSINESS" as never}>
        <div>Business Form</div>
      </PlanGate>
    );

    await waitFor(() => {
      expect(screen.getByText(/1\/1 free post left/i)).toBeTruthy();
    });

    expect(businessCountEqCalls).toEqual(
      expect.arrayContaining([
        { column: "owner_id", value: "u1" },
        { column: "area", value: "MZANSI_BUSINESS" },
      ])
    );
    expect(screen.queryByText(/posting limit reached/i)).toBeNull();
  });

  it("counts Tourism & Events promotions and tourism businesses together", async () => {
    const promotionCountEqCalls: Array<{ column: string; value: unknown }> = [];
    const businessCountEqCalls: Array<{ column: string; value: unknown }> = [];

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
                          data: null,
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
      if (table === "promotions") {
        return createCountQuery(1, promotionCountEqCalls);
      }
      if (table === "businesses") {
        return createCountQuery(1, businessCountEqCalls);
      }
      if (table === "free_posts_used") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ count: 1, error: null }),
              }),
            }),
          }),
        };
      }

      return {};
    });

    render(
      <PlanGate area={"PROMOTIONS_EVENTS" as never}>
        <div>Tourism Form</div>
      </PlanGate>
    );

    await waitFor(() => {
      expect(screen.getByText(/choose your plan to start posting/i)).toBeTruthy();
    });

    expect(promotionCountEqCalls).toEqual(
      expect.arrayContaining([{ column: "owner_id", value: "u1" }])
    );
    expect(businessCountEqCalls).toEqual(
      expect.arrayContaining([
        { column: "owner_id", value: "u1" },
        { column: "area", value: "PROMOTIONS_EVENTS" },
      ])
    );
  });
});
