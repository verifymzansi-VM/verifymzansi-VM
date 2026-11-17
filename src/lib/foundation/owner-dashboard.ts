import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { FoundationAccountContextError, type FoundationAccountContext } from "./account-context";
import type { User } from "@supabase/supabase-js";
import { foundationVerificationStatusSchema } from "./verification-status";
import { restoredAccountProfile } from "./restored-profile";
import { foundationMediaUrl } from "./public-cards";
import { restoredAreaSchema } from "./areas";

const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const snapshot = z
  .strictObject({
    version: z.literal(1),
    account_id: z.uuid(),
    generated_at: instant,
    verification: foundationVerificationStatusSchema,
    profile_facts: z.strictObject({
      legal_name_locked_at: instant.nullable(),
      phone_changed_at: instant.nullable(),
      phone_verified_at: instant.nullable(),
      identity_reviewed_at: instant.nullable(),
      id_document_uploaded_at: instant.nullable().optional(),
      selfie_uploaded_at: instant.nullable().optional(),
      location_province: z.string().nullable(),
      location_city: z.string().nullable(),
      location_confirmed_at: instant.nullable(),
    }),
    counts: z.strictObject({
      active_listings: count,
      active_events: count,
      rejected_listings: count,
      pending_listings: count,
      expiring_listings: count,
      expiring_events: count,
      businesses: count,
      tourism_businesses: count,
    }),
    unread_leads: count,
    unread_notifications: count,
    organisation_admin_count: count,
    posts: z
      .array(
        z.strictObject({
          id: z.uuid(),
          title: z.string().nullable(),
          status: z.enum([
            "draft",
            "pending_moderation",
            "live",
            "paused",
            "rejected",
            "expired",
            "sold",
            "archived",
          ]),
          created_at: instant,
          updated_at: instant,
          expires_at: instant.nullable(),
          area: z.literal("MZANSI_MARKET"),
          cover_object_key: z
            .string()
            .regex(/^media\/[a-f0-9-]{36}$/)
            .nullable(),
        })
      )
      .max(10),
    recent_leads: z
      .array(
        z.strictObject({
          id: z.uuid(),
          status: z.enum(["new", "read", "contacted", "closed"]),
          message: z.string(),
          buyer_name: z.string().nullable(),
          created_at: instant,
          target_id: z.uuid(),
          target_type: z.enum(["listing", "business", "promotion"]).nullable(),
          title: z.string().nullable(),
        })
      )
      .max(3),
    paid_plans: z
      .array(
        z.strictObject({
          id: z.uuid(),
          area: restoredAreaSchema.nullable(),
          label: z.string().nullable(),
          tier: z.enum(["enterprise", "half_year", "quarter", "month", "year"]).nullable(),
          status: z.literal("active"),
        })
      )
      .max(1000),
  })
  .refine(
    (value) => !value.verification.verified || Boolean(value.profile_facts.identity_reviewed_at)
  )
  .refine(
    (value) => value.verification.phone_verified === Boolean(value.profile_facts.phone_verified_at)
  )
  .refine(
    (value) =>
      value.verification.locality_confirmed === Boolean(value.profile_facts.location_confirmed_at)
  )
  .refine((value) => new Set(value.posts.map((p) => p.id)).size === value.posts.length)
  .refine(
    (value) => new Set(value.recent_leads.map((p) => p.id)).size === value.recent_leads.length
  );
export type FoundationOwnerDashboard = z.infer<typeof snapshot>;
export function parseOwnerDashboard(input: unknown, accountId: string) {
  const value = snapshot.parse(input);
  if (value.account_id !== accountId) throw new Error("Dashboard account changed");
  return value;
}
export async function readFoundationOwnerDashboard(
  api: FoundationAuthenticatedApi,
  accountId: string
) {
  const [{ data, error }, identity] = await Promise.all([
    api.rpc("get_my_dashboard", {}, { get: false }),
    api.rpc("get_my_frontend_identity_state", {}, { get: false }),
  ]);
  if (error)
    throw new FoundationAccountContextError(error.code === "42501" ? "forbidden" : "unavailable");
  const parsed = parseOwnerDashboard(data, accountId);
  if (identity.error) throw new FoundationAccountContextError("unavailable");
  const current = z
    .strictObject({
      account_id: z.uuid(),
      case_id: z.uuid().nullable(),
      case_version: z.number().int().positive().nullable(),
      reason: z.string().nullable(),
      decision: z.enum(["rejected", "needs_resubmission"]).nullable(),
      identity_reviewed_at: instant.nullable(),
      id_document_uploaded_at: instant.nullable(),
      selfie_uploaded_at: instant.nullable(),
    })
    .parse(identity.data);
  if (
    current.account_id !== accountId ||
    current.case_id !== parsed.verification.case_id ||
    current.case_version !== parsed.verification.version ||
    current.reason !== parsed.verification.return_reason ||
    Boolean(current.reason) !== Boolean(current.decision) ||
    (parsed.verification.verified && !current.identity_reviewed_at)
  )
    throw new FoundationAccountContextError("unavailable");
  return {
    ...parsed,
    profile_facts: {
      ...parsed.profile_facts,
      identity_reviewed_at: current.identity_reviewed_at,
      id_document_uploaded_at: current.id_document_uploaded_at,
      selfie_uploaded_at: current.selfie_uploaded_at,
    },
    verification: {
      ...parsed.verification,
      ...(current.decision ? { return_decision: current.decision } : {}),
    },
  };
}

/** Only canonical facts become verification status. Pending/review history has
 * no manufactured timestamp and user-editable Auth metadata grants no badge. */
export function dashboardVerificationSteps(value: FoundationOwnerDashboard) {
  const rows: Array<{
    step_type: string;
    status: string;
    reviewed_at: string | null;
    submitted_at?: string | null;
  }> = [];
  const facts = value.profile_facts;
  if (value.verification.phone_verified)
    rows.push({ step_type: "phone", status: "approved", reviewed_at: facts.phone_verified_at });
  if (value.verification.locality_confirmed)
    rows.push({
      step_type: "location",
      status: "approved",
      reviewed_at: facts.location_confirmed_at,
    });
  const identity = facts.identity_reviewed_at
    ? "approved"
    : value.verification.return_reason
      ? (value.verification.return_decision ?? "needs_resubmission")
      : value.verification.submission_pending
        ? "pending"
        : null;
  if (identity)
    for (const step_type of ["id_doc", "selfie"])
      rows.push({
        step_type,
        status: identity,
        reviewed_at: identity === "approved" ? facts.identity_reviewed_at : null,
        submitted_at:
          step_type === "id_doc" ? facts.id_document_uploaded_at : facts.selfie_uploaded_at,
      });
  return rows;
}
export function presentedDashboardProfile(
  value: FoundationOwnerDashboard,
  account: FoundationAccountContext,
  user: User
) {
  if (value.account_id !== account.account_id || value.account_id !== user.id)
    throw new Error("Dashboard account changed");
  return {
    ...restoredAccountProfile(account, user, value.verification),
    revision: account.profile.revision,
    legal_name_locked_at: value.profile_facts.legal_name_locked_at,
    contact_last_phone_change_at: value.profile_facts.phone_changed_at,
    location_province: value.profile_facts.location_province,
    location_city: value.profile_facts.location_city,
    location_verified_at: value.profile_facts.location_confirmed_at,
  };
}
export function dashboardPosts(value: FoundationOwnerDashboard) {
  return value.posts.map(({ cover_object_key, ...post }) => ({
    ...post,
    photos: cover_object_key ? [foundationMediaUrl(cover_object_key)!] : [],
    view_count: null,
  }));
}
