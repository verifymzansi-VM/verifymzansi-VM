import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { parseStaffModerationQueue, readStaffModerationQueue } from "./staff-moderation-queue";
import { FoundationStaffReadError } from "./staff-read";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const staff = uuid(1);
const owner = uuid(2);
const at = "2026-11-10T08:00:00+02:00";
const later = "2026-11-10T09:00:00+02:00";
type Kind = "listing" | "business" | "event";
type Area = "market" | "business" | "tourism_events";

const ownerPost = (
  id: string,
  kind: Kind,
  area: Area,
  overrides: Record<string, unknown> = {}
) => ({
  id,
  kind,
  area,
  category: "vehicles",
  activity: null,
  status: "pending_moderation",
  status_reason: null,
  revision: 3,
  edit_of: null,
  created_at: at,
  updated_at: at,
  published_at: null,
  expires_at: null,
  content: {
    title: "Reviewed title",
    description: "Reviewed description",
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
    kind === "event" ? { starts_at: at, ends_at: later, timezone: "Africa/Johannesburg" } : null,
  contact_channels: null,
  media: [],
  frontend: { data: {}, media: [] },
  contacts: {},
  pending_edit: null,
  ...overrides,
});
const summary = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: uuid(100 + n),
  kind: "listing" as Kind,
  area: "market" as Area,
  category: "vehicles",
  title: "Summary title",
  created_at: at,
  updated_at: later,
  revision: 3,
  edit_of: null as string | null,
  owner_id: null as string | null,
  claim: null as unknown,
  review: null as unknown,
  live: null as unknown,
  ...overrides,
});
const myClaim = {
  mine: true,
  holderName: "You",
  expiresAt: later,
  generation: "7",
  nonce: uuid(9),
};
const otherClaim = {
  mine: false,
  holderName: "Another reviewer",
  expiresAt: later,
  generation: null,
  nonce: null,
};
const claimed = (n: number, kind: Kind = "listing", area: Area = "market") =>
  summary(n, {
    kind,
    area,
    owner_id: owner,
    claim: myClaim,
    review: ownerPost(uuid(100 + n), kind, area),
  });
const queue = (items: unknown[], overrides: Record<string, unknown> = {}) => ({
  account_id: staff,
  total: items.length,
  my_claims: 0,
  items,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("parseStaffModerationQueue", () => {
  it("shows an unclaimed row as a summary without review data or fences", () => {
    const row = summary(1, { claim: otherClaim });
    const result = parseStaffModerationQueue(queue([row], { total: 40, my_claims: 2 }), staff);
    expect(result.totalWaiting).toBe(40);
    expect(result.myClaims).toBe(2);
    expect(result.failedAreas).toEqual([]);
    expect(result.allItems).toHaveLength(1);
    const [item] = result.allItems;
    expect(item).toMatchObject({
      id: row.id,
      title: "Summary title",
      status: "pending_moderation",
      area: "MZANSI_MARKET",
      areaLabel: "Mzansi Market",
      contentType: "listing",
      itemType: "Listing",
      isEditRequest: false,
    });
    expect(item).not.toHaveProperty("foundation");
    expect(item).not.toHaveProperty("owner_id");
    expect(result.claims).toEqual({
      [`listing:${row.id}`]: { mine: false, holderName: "Another reviewer", expiresAt: later },
    });
  });

  it("falls back to a neutral title when an unclaimed row has none", () => {
    const result = parseStaffModerationQueue(queue([summary(2, { title: null })]), staff);
    expect(result.allItems[0]!.title).toBe("Untitled post");
  });

  it("gives the reviewer's own claim the full review data and exact fences", () => {
    const row = claimed(3);
    const [item] = parseStaffModerationQueue(queue([row]), staff).allItems;
    expect(item).toMatchObject({
      id: row.id,
      title: "Reviewed title",
      description: "Reviewed description",
      owner_id: owner,
      status: "pending_moderation",
      foundation: { expectedRevision: 3, claimGeneration: "7", claimNonce: uuid(9) },
    });
  });

  it("shows an edit request beside the live post it would change", () => {
    const liveId = uuid(50);
    const row = summary(4, {
      kind: "business",
      area: "business",
      edit_of: liveId,
      owner_id: owner,
      claim: myClaim,
      review: ownerPost(uuid(104), "business", "business", { edit_of: liveId }),
      live: ownerPost(liveId, "business", "business", {
        status: "live",
        content: { ...ownerPost(liveId, "business", "business").content, title: "Live title" },
      }),
    });
    const result = parseStaffModerationQueue(queue([row]), staff);
    const [item] = result.allItems;
    expect(item).toMatchObject({
      itemType: "Business edit",
      isEditRequest: true,
      targetId: liveId,
      current_snapshot: { id: liveId, title: "Live title" },
    });
    expect(item!.change_summary).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "title" })])
    );
    expect(Object.keys(result.claims)).toEqual([`content_edit:${row.id}`]);
  });

  it.each([
    ["listing", "market", "Listing", "Mzansi Market", "listing"],
    ["business", "business", "Business", "Mzansi Business", "business"],
    ["business", "tourism_events", "Tourism business", "Tourism & Events", "business"],
    ["event", "tourism_events", "Event", "Tourism & Events", "promotion"],
  ] as const)("labels a %s in %s as %s", (kind, area, itemType, areaLabel, contentType) => {
    const row = summary(5, { kind, area, claim: otherClaim });
    const result = parseStaffModerationQueue(queue([row]), staff);
    expect(result.allItems[0]).toMatchObject({ itemType, areaLabel, contentType });
    expect(Object.keys(result.claims)).toEqual([`${contentType}:${row.id}`]);
  });

  it.each([
    ["a queue for another staff account", () => queue([summary(6)], { account_id: uuid(8) })],
    ["the same row twice", () => queue([summary(7), summary(7)])],
    ["a listing outside the market", () => queue([summary(8, { area: "business" })])],
    ["a business in the market", () => queue([summary(9, { kind: "business" })])],
    ["an event outside tourism", () => queue([summary(10, { kind: "event", area: "business" })])],
    [
      "review data without the reviewer's claim",
      () => queue([{ ...claimed(11), claim: otherClaim }]),
    ],
    ["review data without an owner", () => queue([{ ...claimed(12), owner_id: null }])],
    [
      "review data for another revision",
      () =>
        queue([
          { ...claimed(13), review: ownerPost(uuid(113), "listing", "market", { revision: 4 }) },
        ]),
    ],
    [
      "review data for another post",
      () => queue([{ ...claimed(14), review: ownerPost(uuid(99), "listing", "market") }]),
    ],
    [
      "review data no longer pending",
      () =>
        queue([
          { ...claimed(15), review: ownerPost(uuid(115), "listing", "market", { status: "live" }) },
        ]),
    ],
    ["an owner on an unclaimed summary", () => queue([summary(16, { owner_id: owner })])],
    [
      "a live post without review data",
      () => queue([summary(17, { live: ownerPost(uuid(50), "listing", "market") })]),
    ],
    [
      "a live post that is not the edit target",
      () =>
        queue([
          {
            ...claimed(18),
            edit_of: uuid(50),
            review: ownerPost(uuid(118), "listing", "market", { edit_of: uuid(50) }),
            live: ownerPost(uuid(51), "listing", "market", { status: "live" }),
          },
        ]),
    ],
  ])("refuses %s", (_label, input) => {
    const failure = (() => {
      try {
        parseStaffModerationQueue(input(), staff);
      } catch (error) {
        return error;
      }
    })();
    expect(failure).toBeInstanceOf(FoundationStaffReadError);
    expect(failure).toMatchObject({ status: 503 });
  });

  it.each([
    ["a held claim without its fence", { claim: { ...myClaim, nonce: null } }],
    ["another reviewer's claim with a fence", { claim: { ...otherClaim, generation: "3" } }],
    [
      "a generation beyond the database range",
      { claim: { ...myClaim, generation: "9223372036854775808" } },
    ],
    ["an unknown area", { area: "mall" }],
    ["an extra field", { owner_email: "owner@example.test" }],
  ])("rejects a row with %s", (_label, overrides) => {
    expect(() => parseStaffModerationQueue(queue([summary(19, overrides)]), staff)).toThrow(
      ZodError
    );
  });

  it("rejects more than twenty claims held by one reviewer", () => {
    expect(() => parseStaffModerationQueue(queue([], { my_claims: 21 }), staff)).toThrow(ZodError);
  });
});

describe("readStaffModerationQueue", () => {
  const rpc = vi.fn();
  const api = { rpc } as unknown as FoundationAuthenticatedApi;

  it("reads up to fifty rows for the signed-in reviewer", async () => {
    rpc.mockResolvedValueOnce({ data: queue([summary(20)]), error: null });
    await expect(readStaffModerationQueue(api, staff)).resolves.toMatchObject({ totalWaiting: 1 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_frontend_staff_moderation_queue",
      { p_limit: 50 },
      { get: false }
    );
  });

  // Deliberately pins today's behaviour: this reader treats EVERY 42501 as a
  // second-factor refusal (mfaRequired), whatever the message says, so a lost
  // role also sends staff to re-verify first. Change this test only together
  // with the reader if it ever tells the two refusals apart.
  it.each([
    ["42501", 403, true],
    ["XX000", 503, false],
  ])("maps database error %s to %i", async (code, status, mfaRequired) => {
    rpc.mockResolvedValueOnce({ data: null, error: { code } });
    const failure = await readStaffModerationQueue(api, staff).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(FoundationStaffReadError);
    expect(failure).toMatchObject({ status, mfaRequired });
  });
});
