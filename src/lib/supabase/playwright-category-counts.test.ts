// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/playwright-fixture-store", () => ({
  listPlaywrightTableRows: mocks.rows,
}));
vi.mock("./playwright-governance", () => ({
  handlePlaywrightKycDecisionRpc: () => undefined,
}));
import { createPlaywrightStubSupabaseClient } from "./playwright-stub";

const now = new Date("2026-10-13T12:00:00.000Z");
const row = (patch: Record<string, unknown> = {}) => ({
  owner_id: "real-owner",
  category: "food_dining",
  business_name: "Local shop",
  description: null,
  area: "MZANSI_BUSINESS",
  status: "live",
  created_at: now.toISOString(),
  expires_at: "2026-10-14T12:00:00.000Z",
  ...patch,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe("Playwright category aggregate parity", () => {
  it("matches public eligibility and the optional owner fixture filter", async () => {
    mocks.rows.mockReturnValue([
      row(),
      row({ category: "tourism_hospitality", area: "PROMOTIONS_EVENTS" }),
      row({ owner_id: "pw-fixture-one" }),
      row({ business_name: "Seed potatoes", description: "Free samples and book a demo" }),
      row({ expires_at: null, created_at: "2026-10-07T12:00:00.000Z" }),
      row({ expires_at: null, created_at: "2026-10-06T12:00:00.000Z" }),
      row({ expires_at: now.toISOString() }),
      row({ status: "draft" }),
      row({ area: "MZANSI_MARKET" }),
      row({ business_name: "[test] shop" }),
      row({ description: "A sandbox business" }),
    ]);
    const client = createPlaywrightStubSupabaseClient();
    const result = await client.rpc("get_business_category_counts");
    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      { category: "food_dining", count: 4 },
      { category: "tourism_hospitality", count: 1 },
    ]);
    const hidden = await client.rpc("get_business_category_counts", { p_hide_fixtures: true });
    expect(hidden.data).toEqual([
      { category: "food_dining", count: 3 },
      { category: "tourism_hospitality", count: 1 },
    ]);
  });
});
