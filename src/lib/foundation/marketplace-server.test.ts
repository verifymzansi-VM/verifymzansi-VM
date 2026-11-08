/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicPostCoreSchema } from "./public-post-contract";
import { toPublicVerification } from "../business-verification/public";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./server-public", () => ({ foundationServerPublicApi: () => ({ rpc }) }));
import {
  restoredOrganisationDirectory,
  restoredHomeCollection,
  restoredProgrammeShowcases,
  restoredListingDetail,
  restoredPublicDetail,
  restoredEventHostBusiness,
} from "./marketplace-server";
afterEach(() => vi.clearAllMocks());

it("treats malformed detail identifiers as missing pages without a database request", async () => {
  expect(await restoredPublicDetail("not-a-post")).toBeNull();
  expect(await restoredPublicDetail("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBeNull();
  expect(rpc).not.toHaveBeenCalled();
});

it("maps only listed organisations whose public detail link still resolves", async () => {
  const entry = {
    slug: "local-org",
    name: "Local organisation",
    organisation_type: "ngo",
    service_area: null,
    province: "gp",
    logo_object_key: null,
    programme_status: "active_paid",
    live_businesses: 1,
    accepting_applications: true,
    on_strip: true,
    on_home: true,
  };
  const detail = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    slug: entry.slug,
    name: entry.name,
    organisation_type: entry.organisation_type,
    description: "Public programme",
    programme_description: null,
    service_area: null,
    province: "gp",
    website: null,
    public_email: null,
    public_phone: null,
    logo_object_key: null,
    programme_status: "active_paid",
    accepting_applications: true,
    affiliation_wording: "Member of",
    live_businesses: 1,
    programmes: [],
  };
  rpc.mockImplementation(async (name: string, args?: { p_slug: string }) => ({
    data:
      name === "public_organisation_directory"
        ? [entry, { ...entry, slug: "ended-org" }]
        : args?.p_slug === entry.slug
          ? detail
          : null,
    error: null,
  }));
  const rows = await restoredOrganisationDirectory();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: detail.id,
    slug: entry.slug,
    on_strip: true,
    on_home: true,
    programmes: [],
  });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "public_organisation_directory",
    "get_public_organisation",
    "get_public_organisation",
  ]);
});

it("preserves selected public contact methods without putting a phone number in the page", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
  const post = {
    id,
    kind: "listing",
    area: "market",
    category: "electronics",
    activity: null,
    title: "Fixture",
    description: null,
    price_mode: "amount",
    price_cents: "100",
    price_negotiable: false,
    province: "gp",
    city: "gp_johannesburg",
    locality: "Johannesburg",
    condition: "good",
    published_at: "2026-10-16T12:00:00Z",
    visible_until: "2027-01-01T00:00:00Z",
    event_window: null,
    media: [],
    seller: { public_name: "Tester T.", avatar_object_key: null, identity_verified: true },
  };
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_public_post") return { data: post, error: null };
    if (name === "get_public_contact_channels") return { data: ["call", "whatsapp"], error: null };
    if (name === "search_post_cards")
      return {
        data: {
          items: [
            {
              ...publicPostCoreSchema.strip().parse(post),
              summary: "",
              score: null,
              preview: { image_key: null, video_key: null },
              presentation: {
                business_type: null,
                event_window: null,
                frontend: { data: {}, media: [] },
              },
            },
          ],
          total: 1,
          next_cursor: null,
          sort: "newest",
          facets: { categories: {} },
          presentation_contract: "restored-public-v1",
        },
        error: null,
      };
    throw new Error(`Unexpected public read ${name}`);
  });
  const row = await restoredListingDetail(id);
  expect(row?.contact_methods).toEqual(["call", "whatsapp"]);
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "get_public_post",
    "get_public_contact_channels",
    "search_post_cards",
  ]);
  expect(JSON.stringify(row)).not.toContain("+27");
});

it("isolates unavailable home previews and optional programme feeds from the page shell", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "Synthetic provider outage" } });
  await expect(restoredHomeCollection("listings")).resolves.toEqual({
    data: null,
    error: { message: "Posts could not be loaded" },
  });
  await expect(restoredProgrammeShowcases("home")).resolves.toEqual([]);
});

describe("event host business", () => {
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
  const business = {
    id,
    kind: "business",
    area: "business",
    category: "food",
    activity: null,
    title: "Fixture Kitchen",
    description: null,
    price_mode: null,
    price_cents: null,
    price_negotiable: false,
    province: "gp",
    city: "gp_johannesburg",
    locality: "Soweto",
    condition: null,
    published_at: "2026-10-16T12:00:00Z",
    visible_until: "2027-01-01T00:00:00Z",
    event_window: null,
    media: [],
    seller: { public_name: "Tester T.", avatar_object_key: null, identity_verified: true },
  };
  const cards = (post: typeof business) => ({
    items: [
      {
        ...publicPostCoreSchema.strip().parse(post),
        summary: "",
        score: null,
        preview: { image_key: null, video_key: null },
        presentation: {
          business_type: "home_business",
          event_window: null,
          frontend: {
            data: {},
            media: [
              {
                purpose: "logo",
                position: 0,
                object_key: "media/cccccccc-cccc-4ccc-8ccc-000000000001",
                width: 200,
                height: 200,
              },
            ],
          },
        },
      },
    ],
    total: 1,
    next_cursor: null,
    sort: "newest",
    facets: { categories: {} },
    presentation_contract: "restored-public-v1",
  });
  const seen = [
    {
      business_id: id,
      verified_at: "2026-10-01T10:00:00Z",
      expires_at: "2027-10-01T10:00:00Z",
      method: "visit",
      city: "Soweto",
    },
  ];
  const cipc = [
    {
      business_id: id,
      verified_at: "2026-10-02T10:00:00Z",
      expires_at: "2027-10-02T10:00:00Z",
      registration_number: "2020/123456/07",
      registered_name: "Fixture Kitchen (Pty) Ltd",
      role: "director",
      position: "Director",
      office: {
        suburb: "Orlando",
        city: "Soweto",
        province: "Gauteng",
        streetLines: ["1 Vilakazi St"],
      },
    },
  ];
  function reads(overrides: Record<string, () => { data: unknown; error: unknown }> = {}) {
    rpc.mockImplementation(async (name: string) => {
      if (overrides[name]) return overrides[name]();
      if (name === "get_public_post") return { data: business, error: null };
      if (name === "get_public_contact_channels") return { data: ["form"], error: null };
      if (name === "search_post_cards") return { data: cards(business), error: null };
      if (name === "get_public_frontend_business_seen") return { data: seen, error: null };
      if (name === "get_public_frontend_business_cipc") return { data: cipc, error: null };
      throw new Error(`Unexpected public read ${name}`);
    });
  }

  it("returns only the card's fields of a publicly live business, with sticker expiry", async () => {
    reads();
    const host = await restoredEventHostBusiness(id);
    expect(host).toEqual({
      id,
      owner_id: null,
      business_name: "Fixture Kitchen",
      logo_url: expect.stringContaining("media/cccccccc-cccc-4ccc-8ccc-000000000001"),
      cipc_verified_at: "2026-10-02T10:00:00Z",
      cipc_expires_at: "2027-10-02T10:00:00Z",
      seen_verified_at: "2026-10-01T10:00:00Z",
      seen_expires_at: "2027-10-01T10:00:00Z",
      seen_method: "visit",
      seen_city: "Soweto",
      owner_verified_role: "director",
      owner_position_title: "Director",
    });
    // No registration number, registered name or office reaches the event page.
    expect(JSON.stringify(host)).not.toMatch(/2020\/123456|Pty|Vilakazi|Orlando/);
    // The stickers stay visible through the page's own expiry recheck.
    expect(toPublicVerification(host!, Date.parse("2026-11-08T00:00:00Z"))).toMatchObject({
      cipc_verified_at: "2026-10-02T10:00:00Z",
      seen_verified_at: "2026-10-01T10:00:00Z",
    });
  });

  it("returns no card when the business is not publicly live or is not a business", async () => {
    reads({ get_public_post: () => ({ data: null, error: null }) });
    expect(await restoredEventHostBusiness(id)).toBeNull();
    reads({
      get_public_post: () => ({
        data: { ...business, kind: "listing", area: "market", price_mode: "on_request" },
        error: null,
      }),
    });
    expect(await restoredEventHostBusiness(id)).toBeNull();
    reads({
      search_post_cards: () => ({ data: { ...cards(business), items: [], total: 0 }, error: null }),
    });
    expect(await restoredEventHostBusiness(id)).toBeNull();
  });

  it("returns no card when a public read fails, so the event page still renders", async () => {
    reads({ get_public_post: () => ({ data: null, error: { message: "outage" } }) });
    expect(await restoredEventHostBusiness(id)).toBeNull();
    reads({
      get_public_frontend_business_cipc: () => ({ data: null, error: { message: "outage" } }),
    });
    expect(await restoredEventHostBusiness(id)).toBeNull();
    reads({ get_public_frontend_business_seen: () => ({ data: [{ bad: true }], error: null }) });
    expect(await restoredEventHostBusiness(id)).toBeNull();
  });

  it("asks nothing for a missing or malformed business id", async () => {
    for (const value of [null, undefined, "", "business-1", 42]) {
      expect(await restoredEventHostBusiness(value)).toBeNull();
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
