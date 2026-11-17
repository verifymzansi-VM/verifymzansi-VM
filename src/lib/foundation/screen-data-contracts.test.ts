/** @vitest-environment node */
// One contract test per restored screen data shape, on canned backend data
// (roadmap M6.6). The live-backend lane runs the same contracts against the
// local test copy: e2e/foundation/screen-data-contracts.spec.ts.
import { describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { FoundationPublicApi } from "./public-api";
import type { FoundationAccountContext } from "./account-context";
import { presentedDashboardProfile, type FoundationOwnerDashboard } from "./owner-dashboard";
import {
  PUBLIC_CARD_NOT_AVAILABLE,
  PUBLIC_POST_NOT_AVAILABLE,
  readRestoredCollection,
  readRestoredPublicDetail,
  restoredPublicRow,
} from "./marketplace-read";
import { OWNER_POST_NOT_AVAILABLE, restoredOwnerPostRow } from "./restored-owner-posts";
import {
  ACCOUNT_PROFILE_NOT_AVAILABLE,
  DASHBOARD_ONLY_PROFILE_FACTS,
  restoredAccountProfile,
} from "./restored-profile";
import { declareNotAvailable, notAvailable } from "./not-available";
import {
  ACCOUNT_PROFILE_CONTRACT,
  DASHBOARD_PROFILE_CONTRACT,
  OWNER_POST_CONTRACT,
  PUBLIC_CARD_CONTRACT,
  PUBLIC_DETAIL_CONTRACT,
  checkScreenRow,
  type ScreenContract,
} from "@/test/contracts/screen-data";

const postId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const owner = "11111111-1111-4111-8111-111111111111";
const mediaId = "33333333-3333-4333-8333-333333333333";
const core = {
  id: postId,
  kind: "business" as const,
  area: "business" as const,
  category: "automotive_services",
  activity: null,
  title: "Synthetic workshop",
  price_mode: null,
  price_negotiable: false,
  price_cents: null,
  province: "gp",
  city: "gp_johannesburg",
  locality: "Johannesburg",
  condition: null,
  published_at: "2026-11-01T10:00:00Z",
};
const presentation = {
  business_type: "standalone_shop",
  event_window: null,
  frontend: { data: { website: "https://example.invalid" }, media: [] },
};
const detail = {
  ...core,
  description: "A synthetic workshop.",
  visible_until: "2026-12-01T10:00:00Z",
  event_window: null,
  media: [
    {
      purpose: "cover" as const,
      position: 0,
      object_key: `media/${mediaId}`,
      kind: "image" as const,
      width: 800,
      height: 600,
      focal_x: null,
      focal_y: null,
    },
  ],
  seller: { public_name: "Thando D.", avatar_object_key: null, identity_verified: true },
};

function publicApi() {
  const rpc = vi.fn(async (name: string) => {
    if (name === "search_post_cards")
      return {
        data: {
          items: [
            {
              ...core,
              summary: "A synthetic workshop.",
              score: null,
              preview: { image_key: `media/${mediaId}`, video_key: null },
              presentation,
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
    if (name === "get_public_post") return { data: detail, error: null };
    if (name === "get_public_contact_channels") return { data: ["call", "form"], error: null };
    return { data: [], error: null };
  });
  return { rpc } as unknown as FoundationPublicApi;
}

const ownerPost = {
  id: postId,
  kind: "listing" as const,
  area: "market" as const,
  category: "electronics",
  activity: null,
  status: "live" as const,
  status_reason: null,
  revision: 2,
  edit_of: null,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
  published_at: "2026-11-02T10:00:00Z",
  expires_at: "2026-12-02T10:00:00Z",
  content: {
    title: "Synthetic phone",
    description: "Works well.",
    province_id: "gp",
    city_id: "gp_johannesburg",
    locality_label: null,
  },
  listing: {
    price_mode: "amount" as const,
    price_cents: 5500,
    price_negotiable: false,
    attributes: { condition: "good" },
    attributes_version: 1 as const,
  },
  business_type: null,
  event_window: null,
  contact_channels: ["form" as const],
  media: [
    {
      object_id: mediaId,
      object_key: `media/${mediaId}`,
      kind: "image" as const,
      state: "ready" as const,
      purpose: "cover" as const,
      position: 0,
      width: 800,
      height: 600,
      focal_x: null,
      focal_y: null,
    },
  ],
  frontend: { data: {}, media: [] },
  contacts: {},
  pending_edit: null,
  deletes_at: null,
};

const account: FoundationAccountContext = {
  version: 1,
  account_id: owner,
  email: "member@example.invalid",
  phone: "+27821234567",
  totp_enrolled: false,
  staff: null,
  profile: {
    display_name: "Synthetic Member",
    public_name: "Synthetic M.",
    bio: null,
    avatar_object_id: null,
    legal_first_name: "Synthetic",
    legal_last_name: "Member",
    legal_name_locked: true,
    identity_verified: true,
    revision: 3,
    updated_at: "2026-11-01T00:00:00Z",
  },
};
const user = { id: owner, created_at: "2026-10-27T00:00:00Z", user_metadata: {} } as User;
const verification = {
  case_id: null,
  version: null,
  verified: true,
  phone_verified: true,
  locality_confirmed: true,
  submission_pending: false,
  return_reason: null,
};
const dashboard = {
  account_id: owner,
  verification,
  profile_facts: {
    legal_name_locked_at: "2026-10-30T00:00:00Z",
    phone_changed_at: "2026-10-29T00:00:00Z",
    location_province: "Gauteng",
    location_city: "Johannesburg",
    location_confirmed_at: "2026-10-29T00:00:00Z",
  },
} as unknown as FoundationOwnerDashboard;

const expectContract = (contract: ScreenContract, row: object) =>
  expect(checkScreenRow(contract, row as Record<string, unknown>)).toEqual([]);

describe("restored screen data contracts (canned backend data)", () => {
  it("public post card: showroom cards keep their contract", async () => {
    const { rows } = await readRestoredCollection(publicApi(), "businesses");
    expect(rows).toHaveLength(1);
    expectContract(PUBLIC_CARD_CONTRACT, rows[0]!);
  });

  it("public post page: post pages keep their contract", async () => {
    const post = await readRestoredPublicDetail(publicApi(), postId);
    expect(post).not.toBeNull();
    const row = restoredPublicRow(post!, post!);
    expectContract(PUBLIC_DETAIL_CONTRACT, row);
    expect(row.seller).toEqual({
      display_name: "Thando D.",
      account_verification_status: "verified",
    });
    expect(row.contact_methods).toEqual(["call", "form"]);
  });

  it("owner post: the owner's posts keep their contract", () => {
    expectContract(OWNER_POST_CONTRACT, restoredOwnerPostRow(ownerPost, owner));
  });

  it("account profile and dashboard profile keep their contracts", () => {
    expectContract(ACCOUNT_PROFILE_CONTRACT, restoredAccountProfile(account, user, verification));
    expectContract(DASHBOARD_PROFILE_CONTRACT, presentedDashboardProfile(dashboard, account, user));
  });
});

describe("not-available markers", () => {
  it("send the placeholders the screens always received", () => {
    const row = restoredPublicRow(core);
    expect(row).toMatchObject({
      boost_until: null,
      featured_until: null,
      featured: false,
      view_count: null,
      like_count: null,
      viewer_has_liked: false,
      location_suburb: null,
      account_profile: null,
      seller: null,
      contact_methods: [],
    });
    expect(restoredOwnerPostRow(ownerPost, owner)).toMatchObject({
      view_count: null,
      like_count: null,
    });
    expect(restoredAccountProfile(account, user, verification)).toMatchObject({
      pending_email: null,
      masked_phone_public: null,
      contact_last_email_change_at: null,
      account_status: "active",
      strikes: 0,
      suspended_until: null,
      banned_at: null,
      ban_reason: null,
      legal_hold: false,
      profile_completeness_score: 0,
      legal_name_locked_at: null,
      contact_last_phone_change_at: null,
      location_province: null,
      location_city: null,
      location_verified_at: null,
    });
  });

  it("give every row its own empty list and declare a reason for every field", () => {
    const first = restoredPublicRow(core);
    const second = restoredPublicRow(core);
    expect(first.contact_methods).not.toBe(second.contact_methods);
    for (const set of [
      PUBLIC_POST_NOT_AVAILABLE,
      PUBLIC_CARD_NOT_AVAILABLE,
      OWNER_POST_NOT_AVAILABLE,
      ACCOUNT_PROFILE_NOT_AVAILABLE,
      DASHBOARD_ONLY_PROFILE_FACTS,
    ])
      for (const field of Object.values(set.fields))
        expect(field.reason.trim().length).toBeGreaterThan(10);
  });
});

describe("checkScreenRow", () => {
  const contract: ScreenContract = {
    name: "sample",
    required: ["id"],
    optional: ["note"],
    notAvailable: [declareNotAvailable({ views: notAvailable(null, "views are not stored") })],
  };
  it("accepts a row that keeps the contract", () => {
    expect(checkScreenRow(contract, { id: "x", note: null, views: null })).toEqual([]);
  });
  it("names a field an adapter blanks without declaring it", () => {
    expect(checkScreenRow(contract, { id: "x", views: null, likes: null })).toEqual([
      "sample: 'likes' is not in the contract (declare it required, optional or not available)",
    ]);
  });
  it("names a required fact that came back blank or missing", () => {
    expect(checkScreenRow(contract, { id: "", views: null })).toEqual([
      "sample: required 'id' is blank",
    ]);
    expect(checkScreenRow(contract, { views: null })).toEqual(["sample: 'id' is missing"]);
  });
  it("names a not-available field that holds a value", () => {
    expect(checkScreenRow(contract, { id: "x", views: 3 })[0]).toContain(
      "'views' is declared not available but holds a value"
    );
  });
  it("names a field listed twice", () => {
    expect(
      checkScreenRow({ ...contract, optional: ["note", "views"] }, { id: "x", views: null })
    ).toContain("sample: 'views' is in more than one list");
  });
});
