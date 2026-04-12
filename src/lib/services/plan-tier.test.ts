import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSelect, mockCreateAdminClient } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  const mockCreateAdminClient = vi.fn(() => ({ from: mockFrom }));
  return { mockSelect, mockCreateAdminClient };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { getActivePlanTierForArea } from "./plan-tier";

describe("getActivePlanTierForArea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function mockQueryChain(data: unknown[] | null, error: unknown = null) {
    const chain = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data, error }),
    };
    mockSelect.mockReturnValue(chain);
    return chain;
  }

  it("returns 'starter' when no entitlements exist", async () => {
    mockQueryChain(null, { message: "No rows" });
    const tier = await getActivePlanTierForArea("user-1", "MZANSI_MARKET");
    expect(tier).toBe("starter");
  });

  it("returns 'starter' when entitlements array is empty", async () => {
    mockQueryChain([]);
    const tier = await getActivePlanTierForArea("user-2", "MZANSI_MARKET");
    expect(tier).toBe("starter");
  });

  it("returns the tier from the first valid entitlement", async () => {
    mockQueryChain([
      { tier: "pro", expires_at: null },
      { tier: "basic", expires_at: null },
    ]);
    const tier = await getActivePlanTierForArea("user-3", "MZANSI_MARKET");
    expect(tier).toBe("pro");
  });

  it("skips expired entitlements", async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    mockQueryChain([
      { tier: "pro", expires_at: pastDate },
      { tier: "basic", expires_at: null },
    ]);
    const tier = await getActivePlanTierForArea("user-4", "MZANSI_MARKET");
    expect(tier).toBe("basic");
  });

  it("returns 'starter' when all entitlements are expired", async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    mockQueryChain([{ tier: "pro", expires_at: pastDate }]);
    const tier = await getActivePlanTierForArea("user-5", "MZANSI_MARKET");
    expect(tier).toBe("starter");
  });

  it("skips entitlements with null tier", async () => {
    mockQueryChain([
      { tier: null, expires_at: null },
      { tier: "basic", expires_at: null },
    ]);
    const tier = await getActivePlanTierForArea("user-6", "MZANSI_MARKET");
    expect(tier).toBe("basic");
  });
});
