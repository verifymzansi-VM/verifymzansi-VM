import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { input, instant, settle, slug, staffReason, text } from "./organisations";
import { settleStaffCommand } from "./staff-command";
import { parseAcquisitionCookie } from "../analytics/acquisition";

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

export async function recordRestoredAcquisitionCookie(
  api: FoundationAuthenticatedApi,
  cookie: string
) {
  if (cookie.length > 4096) return;
  const touch = parseAcquisitionCookie(cookie);
  if (!touch) return;
  const value: Record<string, unknown> = {};
  const fields = {
    partner_code: touch.partnerCode,
    organisation_slug: touch.organisationSlug,
    campaign:
      typeof touch.campaignId === "string"
        ? touch.campaignId.trim().toLowerCase().replace(/\s+/g, "-")
        : undefined,
    source: typeof touch.source === "string" ? touch.source.toLowerCase() : undefined,
    landing_path: touch.landingPath,
    referrer_host: touch.referrerHost,
    first_touch_at: touch.firstTouchAt,
  } as const;
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
    const field = acquisition.shape[key].safeParse(fields[key]);
    if (field.success && field.data !== undefined) value[key] = field.data;
  }
  const utm: Record<string, string> = {};
  for (const key of utmKey.options) {
    const field = text(1, 100, false).safeParse(touch.utm?.[key]);
    if (field.success) utm[key] = field.data;
  }
  if (Object.keys(value).length || Object.keys(utm).length)
    await recordFoundationAcquisition(api, { ...value, utm });
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
const partnerResult = z.strictObject({
  id: z.uuid(),
  code: z.string(),
  status: z.enum(["pending", "active", "suspended"]),
  commission_bps: z.number().int().nullable(),
  revision: z.number().int().min(1),
});
export function saveRestoredPartner(api: FoundationAuthenticatedApi, value: unknown) {
  const v = partnerChange.extend({ note: text(1, 1000, true).optional() }).parse(value);
  return settleStaffCommand(
    api.rpc(
      "save_frontend_partner",
      {
        p_account: v.account_id,
        p_action: v.action,
        p_reason: v.reason,
        ...(v.code === undefined ? {} : { p_code: v.code }),
        ...(v.commission_bps === undefined ? {} : { p_rate: v.commission_bps }),
        ...(v.note === undefined ? {} : { p_note: v.note }),
      },
      { get: false }
    ),
    partnerResult
  );
}
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
    partnerResult
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
function commissionRpc(api: FoundationAuthenticatedApi, v: z.infer<typeof commissionDecision>) {
  return api.rpc("staff_decide_commission", {
    p_commission: v.commission_id.toLowerCase(),
    p_action: v.action,
    p_reason: v.reason,
    ...(v.action === "mark_paid" ? { p_reference: v.reference } : {}),
  });
}
export async function decideFoundationCommission(api: FoundationAuthenticatedApi, value: unknown) {
  return settle(
    commissionRpc(api, input(commissionDecision, value)),
    z.strictObject({ id: z.uuid(), status: commissionStatus })
  );
}

export function decideRestoredCommission(api: FoundationAuthenticatedApi, value: unknown) {
  const v = commissionDecision.parse(value);
  const expected = { approve: "approved", mark_paid: "paid", reverse: "reversed" } as const;
  return settleStaffCommand(
    commissionRpc(api, v),
    z.strictObject({ id: z.literal(v.commission_id), status: z.literal(expected[v.action]) })
  );
}

export function readRestoredPartnerAdmin(api: FoundationAuthenticatedApi, actorId: string) {
  const rate = z.number().int().min(0).max(5000);
  return settleStaffCommand(
    api.rpc("get_frontend_partner_admin", {}, { get: false }),
    z.strictObject({
      actor_id: z.literal(actorId),
      default_rate_bps: rate,
      partners: z
        .array(
          z.strictObject({
            id: z.uuid(),
            account_id: z.uuid(),
            code: z.string().regex(/^[A-Z0-9]{4,16}$/),
            status: z.enum(["pending", "active", "suspended"]),
            commission_bps: rate.nullable(),
            created_at: instant,
            display_name: z.string().max(120).nullable(),
            referrals: z.number().int().nonnegative(),
          })
        )
        .max(500),
      commissions: z
        .array(
          z.strictObject({
            id: z.uuid(),
            partner_id: z.uuid(),
            partner_code: z.string().regex(/^[A-Z0-9]{4,16}$/),
            base_cents: cents,
            amount_cents: cents,
            rate_bps: rate,
            status: commissionStatus,
            eligible_at: instant,
            created_at: instant,
            payment_status: z.enum([
              "pending",
              "complete",
              "failed",
              "cancelled",
              "expired",
              "refunded",
              "chargeback",
            ]),
          })
        )
        .max(200),
    })
  );
}
