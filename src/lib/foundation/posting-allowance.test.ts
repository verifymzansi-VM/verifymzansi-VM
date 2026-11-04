/** @vitest-environment node */
import { expect, it } from "vitest";
import {
  postingAllowanceSchema,
  restoredPostingPlanInfo,
  restoredPostingPlans,
} from "./posting-allowance";
import { trialAvailabilityMessage } from "../billing/free-posts";
const id = "11111111-1111-4111-8111-111111111111";
const facts = () =>
  postingAllowanceSchema.parse({
    account_id: id,
    profile_exists: true,
    capacity: 0,
    used: 0,
    max_photos: 10,
    max_videos: 1,
    tier: "free",
    trial_ends_at: null,
    trial_used: false,
    trial_offer: {
      eligible: true,
      sevenDayAvailable: true,
      thirtyDayAvailable: true,
      remaining: null,
      launchEnabled: true,
      shortDays: 7,
      longDays: 30,
    },
  });
it("offers a new trial without inventing scarcity or bypass authority", () => {
  const view = restoredPostingPlanInfo(facts());
  expect(view).toMatchObject({
    tier: "free",
    isTrial: true,
    freePostAvailable: true,
    maxAllowed: 1,
    postingLimitBypassEnabled: false,
  });
  expect(trialAvailabilityMessage(view.offer)).toBe(
    "30-day trial available once per verified identity."
  );
});
it("uses an existing shared or trial allowance without offering another grant", () => {
  const view = restoredPostingPlanInfo({
    ...facts(),
    capacity: 4,
    used: 3,
    tier: "active",
    max_photos: 8,
    max_videos: 0,
    trial_used: true,
  });
  expect(view).toMatchObject({
    tier: "active",
    freePostAvailable: false,
    isTrial: false,
    maxAllowed: 4,
    currentCount: 3,
    maxPhotos: 8,
    videoAllowed: false,
  });
});
it("keeps an expired and consumed trial closed", () => {
  const base = facts();
  expect(
    restoredPostingPlanInfo({
      ...base,
      trial_used: true,
      trial_offer: {
        ...base.trial_offer,
        eligible: false,
        sevenDayAvailable: false,
        thirtyDayAvailable: false,
      },
      max_photos: 0,
      max_videos: 0,
    })
  ).toMatchObject({ freePostAvailable: false, maxAllowed: 0, maxPhotos: 0, videoAllowed: false });
});
it("shows only unambiguous native retail prices and features", () => {
  const plan = {
    id,
    code: "market_month",
    label: "Current price",
    area: "market" as const,
    price_cents: "7300",
    currency: "ZAR" as const,
    duration_days: 30,
    slot_capacity: 1,
    max_photos: 6,
    max_videos: 0,
    addon_capabilities: ["urgent" as const],
  };
  const offers = restoredPostingPlans({ plans: [plan], addons: [] }, "MZANSI_MARKET");
  expect(offers).toHaveLength(1);
  expect(offers[0]).toMatchObject({
    priceCents: 7300,
    features: { maxPhotos: 6, videoAllowed: false, urgentAllowed: true, boostAllowed: false },
  });
  expect(
    restoredPostingPlans(
      { plans: [plan, { ...plan, id: "22222222-2222-4222-8222-222222222222" }], addons: [] },
      "MZANSI_MARKET"
    )
  ).toEqual([]);
  expect(restoredPostingPlans({ plans: [plan], addons: [] }, "MZANSI_BUSINESS")).toEqual([]);
});
