import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { input, instant, key, settle, slug } from "./organisations";

const count = z.number().int().nonnegative();
const revision = z.number().int().min(1).max(2147483647);
const cents = z.string().regex(/^[0-9]{1,15}$/);
const commissionStatus = z.enum(["pending", "approved", "paid", "reversed"]);

/** These commands use the caller's session. SQL checks the current staff
 * capability and recent TOTP; no service-role client or browser role claim. */
export async function readFoundationStaffOrganisations(api: FoundationAuthenticatedApi) {
  return settle(
    api.rpc("staff_list_organisations"),
    z
      .array(
        z.strictObject({
          id: z.uuid(),
          slug,
          name: z.string(),
          programme_status: z.enum([
            "invited",
            "founding_trial",
            "active_paid",
            "affiliation_only",
            "suspended",
            "ended",
          ]),
          is_public: z.boolean(),
          revision,
          updated_at: instant,
        })
      )
      .max(500)
  );
}

export async function readFoundationStaffShowcases(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const v = input(z.strictObject({ organisation_id: z.uuid() }), value);
  return settle(
    api.rpc("staff_list_programme_showcases", { p_org: v.organisation_id.toLowerCase() }),
    z
      .array(
        z.strictObject({
          id: z.uuid(),
          programme_id: z.uuid().nullable(),
          title: z.string(),
          placement: z.enum(["home", "business", "tourism", "market"]),
          enabled: z.boolean(),
          starts_at: instant,
          ends_at: instant,
          max_cards: z.number().int().min(3).max(48),
          province: key.nullable(),
          city: key.nullable(),
          display_order: count,
          sponsored_only: z.boolean(),
          revision,
          updated_at: instant,
        })
      )
      .max(20)
  );
}

export async function readFoundationStaffPartners(api: FoundationAuthenticatedApi) {
  return settle(
    api.rpc("staff_list_partners"),
    z
      .array(
        z.strictObject({
          id: z.uuid(),
          account_id: z.uuid(),
          code: z.string().regex(/^[A-Z0-9]{4,16}$/),
          status: z.enum(["pending", "active", "suspended"]),
          commission_bps: z.number().int().min(0).max(5000).nullable(),
          revision,
          referrals: count,
          pending_cents: cents,
          approved_cents: cents,
        })
      )
      .max(500)
  );
}

export async function readFoundationStaffCommissions(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const v = input(
    z.strictObject({ partner_id: z.uuid().optional(), status: commissionStatus.optional() }),
    value
  );
  return settle(
    api.rpc("staff_list_commissions", {
      ...(v.partner_id === undefined ? {} : { p_partner: v.partner_id.toLowerCase() }),
      ...(v.status === undefined ? {} : { p_status: v.status }),
    }),
    z
      .array(
        z.strictObject({
          id: z.uuid(),
          partner_id: z.uuid(),
          payment_id: z.uuid(),
          base_cents: cents,
          rate_bps: z.number().int().min(0).max(5000),
          amount_cents: cents,
          status: commissionStatus,
          eligible_at: instant,
          approved_at: instant.nullable(),
          paid_at: instant.nullable(),
          paid_reference: z.string().nullable(),
          reversed_at: instant.nullable(),
          reversal_reason: z.string().nullable(),
          created_at: instant,
        })
      )
      .max(500)
  );
}
