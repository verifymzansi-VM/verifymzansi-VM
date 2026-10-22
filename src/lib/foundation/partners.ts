import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { input, instant, settle, slug, staffReason, text } from "./organisations";

const cents = z.string().regex(/^[0-9]{1,15}$/);
const commissionStatus = z.enum(["pending", "approved", "paid", "reversed"]);
const utmKey = z.enum(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]);

const acquisition = z.strictObject({
  partner_code: z
    .string()
    .regex(/^[A-Za-z0-9]{4,16}$/)
    .optional(),
  organisation_slug: slug.optional(),
  source: z.enum(["direct", "organic", "social", "paid_campaign", "strategic_invite"]).optional(),
  campaign: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,79}$/)
    .optional(),
  landing_path: z
    .string()
    .max(300)
    .regex(/^[/][A-Za-z0-9/_.~-]*$/)
    .optional(),
  referrer_host: z
    .string()
    .max(200)
    .regex(/^[a-z0-9-]+([.][a-z0-9-]+)+$/)
    .optional(),
  utm: z.partialRecord(utmKey, text(1, 100, false)).default({}),
  first_touch_at: instant.optional(),
});
/** First-touch attribution for the signed-in member, from the first-visit
 * cookie. Only the first record counts and only within 7 days of sign-up. */
export async function recordFoundationAcquisition(api: FoundationAuthenticatedApi, value: unknown) {
  const v = input(acquisition, value);
  return settle(
    api.rpc("record_my_acquisition", {
      p_utm: v.utm,
      ...(v.partner_code === undefined ? {} : { p_partner_code: v.partner_code }),
      ...(v.organisation_slug === undefined ? {} : { p_organisation_slug: v.organisation_slug }),
      ...(v.source === undefined ? {} : { p_source: v.source }),
      ...(v.campaign === undefined ? {} : { p_campaign: v.campaign }),
      ...(v.landing_path === undefined ? {} : { p_landing_path: v.landing_path }),
      ...(v.referrer_host === undefined ? {} : { p_referrer_host: v.referrer_host }),
      ...(v.first_touch_at === undefined ? {} : { p_first_touch_at: v.first_touch_at }),
    }),
    z.strictObject({
      source: z
        .enum([
          "direct",
          "organic",
          "social",
          "paid_campaign",
          "strategic_invite",
          "partner",
          "organisation",
        ])
        .nullable(),
      recorded: z.boolean(),
    })
  );
}

/** The caller's partner summary, or null when they are not a partner. */
export async function readFoundationPartnerDashboard(api: FoundationAuthenticatedApi) {
  return settle(
    api.rpc("my_partner_dashboard"),
    z
      .strictObject({
        code: z.string().regex(/^[A-Z0-9]{4,16}$/),
        status: z.enum(["pending", "active", "suspended"]),
        rate_bps: z.number().int().min(0).max(5000),
        referrals: z.number().int().min(0),
        paying_referrals: z.number().int().min(0),
        totals: z.partialRecord(commissionStatus, cents),
        recent: z
          .array(
            z.strictObject({
              id: z.uuid(),
              amount_cents: cents,
              base_cents: cents,
              status: commissionStatus,
              created_at: instant,
              eligible_at: instant,
              paid_at: instant.nullable(),
            })
          )
          .max(50),
      })
      .nullable()
  );
}

// ── Staff (partner:manage, recent second factor) ────────────────────────

const partnerChange = z.strictObject({
  account_id: z.uuid(),
  action: z.enum(["create", "activate", "suspend", "set_rate"]),
  code: z
    .string()
    .regex(/^[A-Z0-9]{4,16}$/)
    .optional(),
  commission_bps: z.number().int().min(0).max(5000).optional(),
  reason: staffReason,
});
export async function saveFoundationPartner(api: FoundationAuthenticatedApi, value: unknown) {
  const v = input(partnerChange, value);
  return settle(
    api.rpc("staff_save_partner", {
      p_account: v.account_id.toLowerCase(),
      p_action: v.action,
      p_reason: v.reason,
      ...(v.code === undefined ? {} : { p_code: v.code }),
      ...(v.commission_bps === undefined ? {} : { p_commission_bps: v.commission_bps }),
    }),
    z.strictObject({
      id: z.uuid(),
      code: z.string(),
      status: z.enum(["pending", "active", "suspended"]),
      commission_bps: z.number().int().nullable(),
      revision: z.number().int().min(1),
    })
  );
}

const commissionDecision = z.discriminatedUnion("action", [
  z.strictObject({ commission_id: z.uuid(), action: z.literal("approve"), reason: staffReason }),
  z.strictObject({
    commission_id: z.uuid(),
    action: z.literal("mark_paid"),
    reference: text(3, 120, false),
    reason: staffReason,
  }),
  z.strictObject({ commission_id: z.uuid(), action: z.literal("reverse"), reason: staffReason }),
]);
export async function decideFoundationCommission(api: FoundationAuthenticatedApi, value: unknown) {
  const v = input(commissionDecision, value);
  return settle(
    api.rpc("staff_decide_commission", {
      p_commission: v.commission_id.toLowerCase(),
      p_action: v.action,
      p_reason: v.reason,
      ...(v.action === "mark_paid" ? { p_reference: v.reference } : {}),
    }),
    z.strictObject({ id: z.uuid(), status: commissionStatus })
  );
}
