import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRedirect = vi.fn();
const mockCreateClient = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

describe("create route guards", () => {
  const layoutLoaders = {
    listing: () => import("@/app/post/create-listing/layout"),
    business: () => import("@/app/post/create-business/layout"),
    promotion: () => import("@/app/post/create-promotion/layout"),
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockServerProfile(status: string) {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { account_verification_status: status },
        }),
      }),
    });
  }

  it.each([
    ["listing", "/verification?returnUrl=%2Fpost%2Fcreate-listing"],
    ["business", "/verification?returnUrl=%2Fpost%2Fcreate-business"],
    ["promotion", "/verification?returnUrl=%2Fpost%2Fcreate-promotion"],
  ] as const)("redirects unverified users away from %s", async (key, expectedRedirect) => {
    mockServerProfile("pending_review");

    const mod = await layoutLoaders[key]();

    await expect(mod.default({ children: <div>Child</div> })).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith(expectedRedirect);
  });

  it.each(["listing", "business", "promotion"] as const)(
    "allows verified users into %s",
    async (key) => {
      mockServerProfile("verified");

      const mod = await layoutLoaders[key]();
      const ui = await mod.default({ children: <div>Allowed</div> });

      expect(ui).toEqual(<div>Allowed</div>);
      expect(mockRedirect).not.toHaveBeenCalled();
    }
  );
});
