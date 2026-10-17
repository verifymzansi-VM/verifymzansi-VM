// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDb } from "@/lib/business-verification/test-db";

const state = vi.hoisted(() => ({
  user: { id: "buyer-1" } as { id: string } | null,
  db: null as ReturnType<typeof createFakeDb> | null,
  limited: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db!.client }));
vi.mock("@/lib/utils/mutation-guard", () => ({ enforceMutationRequest: () => null }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: async () => ({ limited: state.limited, retryAfter: 60 }),
  getClientIp: () => "198.51.100.7",
}));

import { POST } from "./route";

const LISTING = "11111111-1111-4111-8111-111111111111";
const BUSINESS = "22222222-2222-4222-8222-222222222222";
const future = new Date(Date.now() + 86_400_000).toISOString();

function seed(listing: Record<string, unknown> = {}, business: Record<string, unknown> = {}) {
  state.db = createFakeDb({
    listings: [
      {
        id: LISTING,
        owner_id: "seller-1",
        status: "live",
        expires_at: future,
        created_at: future,
        contact_methods: ["call"],
        ...listing,
      },
    ],
    businesses: [
      {
        id: BUSINESS,
        owner_id: "owner-2",
        status: "live",
        expires_at: future,
        created_at: future,
        contact_methods: null,
        ...business,
      },
    ],
    // Business contact details live only in the server-only private table.
    business_private: [
      {
        business_id: BUSINESS,
        phone: "+27821111111",
        whatsapp: "+27822222222",
        email: "shop@example.co.za",
      },
    ],
    account_profiles: [
      { user_id: "seller-1", phone: "+27833333333", account_verification_status: "verified" },
      { user_id: "owner-2", phone: "+27844444444", account_verification_status: "verified" },
    ],
    contact_events: [],
  });
}

const reveal = (targetType: string, targetId: string) =>
  POST(
    new Request("https://verifymzansi.com/api/contact/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType, targetId }),
    }) as never
  );

beforeEach(() => {
  state.user = { id: "buyer-1" };
  state.limited = false;
  seed();
});

describe("POST /api/contact/reveal", () => {
  it("shows the number to signed-out visitors too, recorded without an account", async () => {
    state.user = null;
    const res = await reveal("listing", LISTING);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ phone: "+27833333333", whatsapp: null, email: null });
    expect(state.db!.tables.contact_events).toEqual([
      expect.objectContaining({ contact_type: "reveal", sender_user_id: null }),
    ]);
  });

  it("reveals only the methods the seller chose, and records it", async () => {
    const res = await reveal("listing", LISTING);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ phone: "+27833333333", whatsapp: null, email: null });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(state.db!.tables.contact_events).toEqual([
      expect.objectContaining({ contact_type: "reveal", sender_user_id: "buyer-1" }),
    ]);
  });

  it("reveals a business's own contact details", async () => {
    const res = await reveal("business", BUSINESS);
    expect(await res.json()).toEqual({
      phone: "+27821111111",
      whatsapp: "+27822222222",
      email: "shop@example.co.za",
    });
  });

  it.each([
    ["form", { phone: null, whatsapp: null, email: null }],
    ["call", { phone: "+27821111111", whatsapp: null, email: null }],
    ["whatsapp", { phone: null, whatsapp: "+27822222222", email: null }],
    ["email", { phone: null, whatsapp: null, email: "shop@example.co.za" }],
  ])(
    "only reveals the selected business method %s despite stale private contacts",
    async (method, expected) => {
      // The target query aliases category_details->contact_methods to contact_methods.
      seed({}, { contact_methods: [method] });
      state.user = null;

      const res = await reveal("business", BUSINESS);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(expected);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
  );

  it.each([
    { status: "pending_moderation" },
    { expires_at: new Date(Date.now() - 86_400_000).toISOString() },
  ])("never reveals private business contacts for unavailable posts: %o", async (business) => {
    seed({}, business);
    const res = await reveal("business", BUSINESS);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This post isn't available." });
    expect(state.db!.tables.contact_events).toEqual([]);
  });

  it("never reveals for posts that aren't live", async () => {
    seed({ status: "pending_moderation" });
    expect((await reveal("listing", LISTING)).status).toBe(404);
  });

  it("is rate-limited against harvesting", async () => {
    state.limited = true;
    expect((await reveal("listing", LISTING)).status).toBe(429);
  });

  it("doesn't record the owner looking at their own post", async () => {
    state.user = { id: "seller-1" };
    await reveal("listing", LISTING);
    expect(state.db!.tables.contact_events).toEqual([]);
  });
});
