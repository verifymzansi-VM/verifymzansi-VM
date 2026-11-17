import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { readRestoredPostManager } from "./post-manager";
import { listRestoredOwnerPosts, type RestoredOwnerPost } from "./restored-owner-posts";
import { readFoundationOwnerDashboard } from "./owner-dashboard";

vi.mock("./restored-owner-posts", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listRestoredOwnerPosts: vi.fn(),
}));
vi.mock("./owner-dashboard", () => ({ readFoundationOwnerDashboard: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = uuid(1);
const at = "2026-11-10T08:00:00+02:00";
const rpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const ownerPost = (id: string, kind: "listing" | "business" | "event"): RestoredOwnerPost => ({
  id,
  kind,
  area: kind === "listing" ? "market" : kind === "business" ? "business" : "tourism_events",
  category: kind === "listing" ? "vehicles" : kind === "business" ? "services" : "events",
  activity: null,
  status: "live",
  status_reason: null,
  revision: 1,
  edit_of: null,
  created_at: at,
  updated_at: at,
  published_at: at,
  expires_at: null,
  content: {
    title: `${kind} title`,
    description: null,
    province_id: null,
    city_id: null,
    locality_label: null,
  },
  listing:
    kind === "listing"
      ? {
          price_mode: "amount",
          price_cents: 1000,
          price_negotiable: false,
          attributes: {},
          attributes_version: 1,
        }
      : null,
  business_type: null,
  event_window:
    kind === "event" ? { starts_at: at, ends_at: at, timezone: "Africa/Johannesburg" } : null,
  contact_channels: null,
  media: [],
  frontend: { data: {}, media: [] },
  contacts: {},
  pending_edit: null,
});
const listing = ownerPost(uuid(10), "listing");
const business = ownerPost(uuid(11), "business");
const event = ownerPost(uuid(12), "event");
const slot = {
  id: uuid(20),
  source: "plan",
  area: "MZANSI_MARKET",
  planName: "Market month",
  status: "active",
  slotCapacity: 3,
  activeUsage: 1,
  activationCount: 1,
  activationLimitTotal: null,
  activationLimitPerPeriod: null,
  activationPeriodDays: 30,
  periodActivations: 1,
  startsAt: at,
  expiresAt: at,
  autoRenew: false,
  sponsored: false,
};
const facts = (overrides: Record<string, unknown> = {}) => ({
  account_id: owner,
  slot_usage: [slot],
  plan_admins: [
    {
      entitlementId: uuid(21),
      slotCapacity: 3,
      expiresAt: at,
      admins: [{ name: "A", email: null }],
    },
  ],
  sponsored_post_ids: [business.id],
  addons: [{ post_id: listing.id, boost_until: at, featured_until: null, urgent_until: at }],
  ...overrides,
});
const plan = (area: string | null, tier: string | null, n: number) => ({
  id: uuid(30 + n),
  area,
  label: null,
  tier,
  status: "active",
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listRestoredOwnerPosts).mockImplementation(async (_api, kind) =>
    kind === "listing" ? [listing] : kind === "business" ? [business] : [event]
  );
  vi.mocked(readFoundationOwnerDashboard).mockResolvedValue({ paid_plans: [] } as never);
});

describe("readRestoredPostManager", () => {
  it("projects each kind of the owner's posts and attaches their add-ons", async () => {
    rpc.mockResolvedValueOnce({ data: facts(), error: null });
    const result = await readRestoredPostManager(api, owner);
    expect(rpc).toHaveBeenCalledWith("get_my_frontend_post_manager", {}, { get: false });
    const [listings, businesses, events] = result.responses;
    expect(listings.data).toEqual([
      expect.objectContaining({
        id: listing.id,
        owner_id: owner,
        area: "MZANSI_MARKET",
        boost_until: at,
        urgent_until: at,
        featured_until: null,
      }),
    ]);
    expect(businesses.data[0]).toMatchObject({ id: business.id, area: "MZANSI_BUSINESS" });
    expect(businesses.data[0]).not.toHaveProperty("boost_until");
    expect(events.data[0]).toMatchObject({ id: event.id, area: "PROMOTIONS_EVENTS" });
    expect(result.sponsoredIds).toEqual(new Set([business.id]));
    expect(result.slotUsage).toEqual([slot]);
    expect(result.planAdmins).toEqual(facts().plan_admins);
    expect(result.tiers).toEqual({
      MZANSI_MARKET: "starter",
      MZANSI_BUSINESS: "starter",
      PROMOTIONS_EVENTS: "starter",
    });
  });

  it("shows the longest paid plan per area and ignores plans without a tier", async () => {
    rpc.mockResolvedValueOnce({ data: facts(), error: null });
    vi.mocked(readFoundationOwnerDashboard).mockResolvedValueOnce({
      paid_plans: [
        plan("MZANSI_MARKET", "year", 1),
        plan("MZANSI_MARKET", "month", 2),
        plan("MZANSI_BUSINESS", "quarter", 3),
        plan("MZANSI_BUSINESS", "enterprise", 4),
        plan("PROMOTIONS_EVENTS", null, 6),
      ],
    } as never);
    await expect(readRestoredPostManager(api, owner)).resolves.toMatchObject({
      tiers: {
        MZANSI_MARKET: "year",
        MZANSI_BUSINESS: "enterprise",
        PROMOTIONS_EVENTS: "starter",
      },
    });
  });

  it("counts a plan for any section (an Individual slot) in every area", async () => {
    rpc.mockResolvedValueOnce({ data: facts(), error: null });
    vi.mocked(readFoundationOwnerDashboard).mockResolvedValueOnce({
      paid_plans: [plan(null, "month", 5), plan("MZANSI_MARKET", "half_year", 1)],
    } as never);
    await expect(readRestoredPostManager(api, owner)).resolves.toMatchObject({
      tiers: {
        MZANSI_MARKET: "half_year",
        MZANSI_BUSINESS: "month",
        PROMOTIONS_EVENTS: "month",
      },
    });
  });

  it("refuses facts for another account", async () => {
    rpc.mockResolvedValueOnce({ data: facts({ account_id: uuid(2) }), error: null });
    await expect(readRestoredPostManager(api, owner)).rejects.toThrow("Account changed");
  });

  it("fails closed on a database error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    await expect(readRestoredPostManager(api, owner)).rejects.toThrow(
      "Post management is temporarily unavailable"
    );
  });

  it.each([
    ["an auto-renewing slot", { slot_usage: [{ ...slot, autoRenew: true }] }],
    ["an inactive slot", { slot_usage: [{ ...slot, status: "expired" }] }],
    ["an unknown slot area", { slot_usage: [{ ...slot, area: "MALL" }] }],
    ["a malformed sponsored post id", { sponsored_post_ids: ["post-1"] }],
    ["an extra field", { owner_email: "owner@example.test" }],
    [
      "an extra add-on field",
      {
        addons: [
          {
            post_id: listing.id,
            boost_until: null,
            featured_until: null,
            urgent_until: null,
            paid_cents: 100,
          },
        ],
      },
    ],
  ])("refuses %s", async (_label, overrides) => {
    rpc.mockResolvedValueOnce({ data: facts(overrides), error: null });
    await expect(readRestoredPostManager(api, owner)).rejects.toThrow();
  });
});
