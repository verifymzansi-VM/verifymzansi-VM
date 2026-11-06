import { expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  listRestoredOwnerPosts,
  readRestoredOwnerPost,
  restoredOwnerPostRow,
} from "./restored-owner-posts";
import { readRestoredGovernance } from "./governance";
import { readFrontendStaffVerificationQueue } from "./staff-verification-queue";

const caller = "11111111-1111-4111-8111-111111111111";
const subject = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const later = "2026-11-06T01:00:00Z";
const at = "2026-11-05T01:00:00Z";
const ok = (data: unknown) => ({ data, error: null });
function fixture(data: unknown) {
  const rpc = vi.fn().mockResolvedValue(ok(data));
  return { api: { rpc } as unknown as FoundationAuthenticatedApi, rpc };
}

const image = {
  object_id: id,
  object_key: "media/" + id,
  kind: "image" as const,
  state: "ready" as const,
  purpose: "cover" as const,
  position: 0,
  width: 800,
  height: 600,
  focal_x: null,
  focal_y: null,
};
const listing = {
  id,
  kind: "listing" as const,
  area: "market" as const,
  category: "vehicles",
  activity: null,
  status: "paused" as const,
  status_reason: "staff_hidden",
  revision: 2,
  edit_of: null,
  created_at: at,
  updated_at: later,
  published_at: null,
  expires_at: null,
  content: {
    title: "Owner draft",
    description: null,
    province_id: "gp",
    city_id: "gp_johannesburg",
    locality_label: null,
  },
  listing: {
    price_mode: "amount" as const,
    price_cents: 5500,
    price_negotiable: false,
    attributes: {},
    attributes_version: 1 as const,
  },
  business_type: null,
  event_window: null,
  contact_channels: ["form" as const],
  media: [
    image,
    { ...image, purpose: "gallery" as const, position: 2 },
    { ...image, kind: "video" as const, purpose: "video" as const },
    { ...image, kind: "video" as const, purpose: "video" as const, position: 1 },
  ],
  frontend: { data: { location_address: "Owner address" }, media: [] },
  contacts: { phone: "+27821112222" },
  pending_edit: null,
};

it("loads and projects an owner draft without losing its moderation state, location or contact choices", async () => {
  const { api, rpc } = fixture(listing);
  const post = await readRestoredOwnerPost(api, id);
  expect(rpc).toHaveBeenCalledWith("get_my_frontend_post", { p_id: id }, { get: false });
  expect(restoredOwnerPostRow(post!, caller)).toMatchObject({
    owner_id: caller,
    status: "hidden",
    status_reason: "Hidden for staff review",
    location_city: "Johannesburg",
    location_province: "Gauteng",
    location_address: "Owner address",
    phone: listing.contacts.phone,
    contact_methods: ["form"],
    price_cents: 5500,
    cover_photo: expect.stringContaining(image.object_key),
  });
  await expect(readRestoredOwnerPost(api, subject)).rejects.toThrow("Post changed");
});

it("rejects duplicate posts and pending edits from the top-level owner collection", async () => {
  const { api, rpc } = fixture({ items: [listing], total: 1, limit: 100, offset: 0 });
  await expect(listRestoredOwnerPosts(api, "listing", "market")).resolves.toHaveLength(1);
  expect(rpc).toHaveBeenCalledWith(
    "list_my_frontend_posts",
    { p_kind: "listing", p_area: "market", p_limit: 100, p_offset: 0 },
    { get: false }
  );
  rpc.mockResolvedValueOnce(ok({ items: [listing, listing], total: 2, limit: 100, offset: 0 }));
  await expect(listRestoredOwnerPosts(api, "listing")).rejects.toThrow("Owner collection changed");
  rpc.mockResolvedValueOnce(
    ok({ items: [{ ...listing, edit_of: subject }], total: 1, limit: 100, offset: 0 })
  );
  await expect(listRestoredOwnerPosts(api, "listing")).rejects.toThrow("Owner collection changed");
});

const decision = {
  id,
  case_id: subject,
  subject_id: subject,
  case_kind: "restriction",
  action: "restrict_account",
  status: "withdrawn",
  case_version: 1,
  current_case_version: 2,
  proposed_by: subject,
  proposed_at: at,
  approved_by: null,
  approved_at: null,
  withdrawn_by: caller,
  withdrawn_at: later,
  withdrawal_reason: "Evidence did not support the proposal",
  can_approve: false,
  can_withdraw: false,
};
const review = {
  native: { version: 1, caller_id: caller, items: [decision], next_cursor: null },
  presentation: [
    {
      decision_id: id,
      recommendation: "Review account restriction",
      events: [
        {
          id: subject,
          action: "reject",
          actor_id: caller,
          reason: decision.withdrawal_reason,
          created_at: later,
        },
      ],
    },
  ],
};

it("presents a rejected governance proposal without claiming the restriction was applied", async () => {
  const { api, rpc } = fixture(review);
  await expect(readRestoredGovernance(api, caller, { id, status: "all" })).resolves.toEqual([
    expect.objectContaining({
      status: "rejected",
      execution_status: null,
      timeline: [
        expect.objectContaining({ event_type: "proposed" }),
        expect.objectContaining({ event_type: "reject" }),
      ],
    }),
  ]);
  await expect(readRestoredGovernance(api, subject, { status: "all" })).rejects.toMatchObject({
    status: 503,
  });
  rpc.mockResolvedValueOnce(
    ok({
      ...review,
      presentation: [
        {
          ...review.presentation[0],
          events: [{ ...review.presentation[0].events[0], actor_id: subject }],
        },
      ],
    })
  );
  await expect(readRestoredGovernance(api, caller, { status: "all" })).rejects.toThrow(
    "Governance outcome could not be confirmed"
  );
});

const group = {
  case_id: id,
  owner_id: subject,
  version: 2,
  display_name: " Reviewed member ",
  created_at: at,
  review_scope: null,
  steps: [
    {
      id,
      step_type: "id_doc",
      created_at: at,
      updated_at: later,
      reviewed_at: null,
      risk_score: 72,
      risk_level: "high",
      auto_status: "awaiting_second_reviewer",
    },
  ],
};
const queue = { account_id: caller, total_steps: 1, groups: [group] };

it("projects the identity queue for the represented staff account only", async () => {
  const { api, rpc } = fixture(queue);
  await expect(readFrontendStaffVerificationQueue(api, caller, 20, [id])).resolves.toMatchObject({
    total: 1,
    groups: [
      {
        user_id: subject,
        account_display_name: "Reviewed member",
        primary_step_id: id,
        steps: [{ claim_case_id: id, status: "pending" }],
      },
    ],
  });
  expect(rpc).toHaveBeenCalledWith(
    "get_frontend_staff_verification_queue",
    { p_limit: 20, p_include_ids: [id] },
    { get: false }
  );
  rpc.mockResolvedValueOnce(ok({ ...queue, groups: [{ ...group, owner_id: caller }] }));
  await expect(readFrontendStaffVerificationQueue(api, caller)).rejects.toMatchObject({
    status: 503,
  });
  rpc.mockResolvedValueOnce(
    ok({ ...queue, groups: [{ ...group, steps: [group.steps[0], group.steps[0]] }] })
  );
  await expect(readFrontendStaffVerificationQueue(api, caller)).rejects.toMatchObject({
    status: 503,
  });
});
