import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationPublicApi } from "./public-api";
import { isPlainText } from "./owner-inbox";

export const instant = z
  .string()
  .regex(
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/
  )
  .pipe(z.iso.datetime({ offset: true }));
export const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .min(3)
  .max(60);
export const key = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
export const objectKey = z.string().regex(/^media[/][a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const programmeStatus = z.enum([
  "invited",
  "founding_trial",
  "active_paid",
  "affiliation_only",
  "suspended",
  "ended",
]);
const organisationType = z.enum([
  "municipality",
  "government_department",
  "led_programme",
  "chamber_of_commerce",
  "tourism_association",
  "incubator",
  "accelerator",
  "enterprise_development",
  "ngo",
  "supplier_development",
  "mall",
  "business_association",
  "cooperative",
  "professional_body",
  "university_tvet",
  "other",
]);
export const text = (min: number, max: number, multiline: boolean) =>
  z
    .string()
    .max(max * 4)
    .transform((value) =>
      value
        .replace(/\r\n?/g, "\n")
        .replace(/^[ \n]+|[ \n]+$/g, "")
        .normalize("NFC")
    )
    .refine((value) => isPlainText(value, min, max, multiline));

export class FoundationOrganisationError extends Error {
  constructor(
    readonly reason:
      | "invalid"
      | "not_found"
      | "conflict"
      | "forbidden"
      | "verification_required"
      | "invite_invalid"
      | "limited"
      | "unavailable"
  ) {
    super(`Foundation organisation request failed: ${reason}`);
  }
}
const reasons = new Map<string, FoundationOrganisationError["reason"]>([
  ...[
    "organisation_invalid",
    "application_invalid",
    "affiliation_invalid",
    "consent_required",
    "reason_required",
    "logo_unavailable",
    "showcase_invalid",
    "acquisition_invalid",
    "partner_invalid",
    "commission_invalid",
  ].map((detail) => [detail, "invalid"] as const),
  ...[
    "organisation_unavailable",
    "business_unavailable",
    "programme_unavailable",
    "application_unavailable",
    "affiliation_unavailable",
    "invite_unavailable",
    "admin_unavailable",
    "sponsorship_unavailable",
    "showcase_unavailable",
    "partner_unavailable",
    "commission_unavailable",
  ].map((detail) => [detail, "not_found"] as const),
  ...[
    "organisation_changed",
    "organisation_slug_taken",
    "organisation_inactive",
    "applications_closed",
    "application_open",
    "application_state",
    "already_affiliated",
    "affiliation_state",
    "admin_exists",
    "admin_limit",
    "programme_inactive",
    "sponsorship_exists",
    "sponsorship_state",
    "sponsorship_owner_unavailable",
    "sponsorship_waitlist_full",
    "showcase_changed",
    "showcase_limit",
    "partner_exists",
    "partner_code_taken",
    "partner_account_unavailable",
    "commission_state",
  ].map((detail) => [detail, "conflict"] as const),
  ["invite_invalid", "invite_invalid"],
  ["invite_email_mismatch", "forbidden"],
  ["self_sponsorship", "forbidden"],
  ["self_partner", "forbidden"],
  ["verification_required", "verification_required"],
  ["application_limit", "limited"],
]);
type OrganisationRpc = PromiseLike<{
  data: unknown;
  error: { code?: string; details?: string | null } | null;
}>;
/** One request, no automatic retry after an uncertain reply. */
export async function settle<T>(request: OrganisationRpc, schema: z.ZodType<T>) {
  const { data, error } = await Promise.resolve(request).then(
    (result) => result,
    () => {
      throw new FoundationOrganisationError("unavailable");
    }
  );
  if (error)
    throw new FoundationOrganisationError(
      (error.details && reasons.get(error.details)) ||
        (error.code === "42501" ? "forbidden" : "unavailable")
    );
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new FoundationOrganisationError("unavailable");
  return parsed.data;
}
export function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new FoundationOrganisationError("invalid");
  return parsed.data;
}

// ── Public ──────────────────────────────────────────────────────────────

const directoryEntry = z.strictObject({
  slug,
  name: z.string(),
  organisation_type: organisationType,
  service_area: z.string().nullable(),
  province: key.nullable(),
  logo_object_key: objectKey.nullable(),
  programme_status: programmeStatus,
  live_businesses: z.number().int().min(0),
  accepting_applications: z.boolean(),
  on_strip: z.boolean(),
  on_home: z.boolean(),
});
export async function readFoundationOrganisationDirectory(api: FoundationPublicApi) {
  return settle(api.rpc("public_organisation_directory"), z.array(directoryEntry).max(200));
}

const publicOrganisation = z
  .strictObject({
    id: z.uuid(),
    slug,
    name: z.string(),
    organisation_type: organisationType,
    description: z.string().nullable(),
    programme_description: z.string().nullable(),
    service_area: z.string().nullable(),
    province: key.nullable(),
    website: z.string().nullable(),
    public_email: z.string().nullable(),
    public_phone: z.string().nullable(),
    logo_object_key: objectKey.nullable(),
    programme_status: programmeStatus,
    accepting_applications: z.boolean(),
    affiliation_wording: z.string(),
    live_businesses: z.number().int().min(0),
    programmes: z.array(
      z.strictObject({ id: z.uuid(), slug, name: z.string(), description: z.string().nullable() })
    ),
  })
  .nullable();
export async function readFoundationPublicOrganisation(api: FoundationPublicApi, value: unknown) {
  const { slug: wanted } = input(z.strictObject({ slug }), value);
  return settle(api.rpc("get_public_organisation", { p_slug: wanted }), publicOrganisation);
}

const badge = z.strictObject({
  post_id: z.uuid(),
  organisation_slug: slug,
  organisation_name: z.string(),
  logo_object_key: objectKey.nullable(),
  label: z.string(),
  programme_name: z.string().nullable(),
  confirmed_at: instant,
});
export async function readFoundationPostAffiliations(api: FoundationPublicApi, value: unknown) {
  const { post_ids } = input(
    z.strictObject({ post_ids: z.array(z.uuid()).min(1).max(100) }),
    value
  );
  return settle(
    api.rpc("public_post_affiliations", {
      p_post_ids: [...new Set(post_ids.map((id) => id.toLowerCase()))],
    }),
    z.array(badge).max(1000)
  );
}

// ── Invitations ─────────────────────────────────────────────────────────

/** SHA-256 hex of an emailed invitation token; only the hash reaches SQL. */
export async function hashFoundationInviteToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** 32 random bytes, base64url, for the invitation email link. */
export function createFoundationInviteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/[+]/g, "-")
    .replace(/[/]/g, "_")
    .replace(/=+$/, "");
}
const inviteToken = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export async function previewFoundationOrganisationInvite(
  api: FoundationPublicApi,
  value: unknown
) {
  const { token } = input(inviteToken, value);
  return settle(
    api.rpc("preview_organisation_invite", {
      p_token_hash: await hashFoundationInviteToken(token),
    }),
    z
      .strictObject({
        organisation_name: z.string(),
        email: z.string(),
        expires_at: instant,
        status: z.enum(["open", "used", "revoked", "expired", "inactive"]),
      })
      .nullable()
  );
}
export async function acceptFoundationOrganisationInvite(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const { token } = input(inviteToken, value);
  return settle(
    api.rpc("accept_organisation_invite", { p_token_hash: await hashFoundationInviteToken(token) }),
    z.strictObject({ organisation_slug: slug, role: z.enum(["owner", "admin"]) })
  );
}

// ── Business owner ──────────────────────────────────────────────────────

const application = z.strictObject({
  organisation_id: z.uuid(),
  post_id: z.uuid(),
  programme_id: z.uuid().optional(),
  share_representative_name: z.boolean(),
  consent: z.literal(true),
  reason: text(2, 1000, true).optional(),
  member_reference: text(1, 120, false).optional(),
});
export async function applyToFoundationOrganisation(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const v = input(application, value);
  return settle(
    api.rpc("apply_to_organisation", {
      p_org: v.organisation_id.toLowerCase(),
      p_post_id: v.post_id.toLowerCase(),
      p_share_representative_name: v.share_representative_name,
      p_consent: true,
      ...(v.programme_id === undefined ? {} : { p_programme: v.programme_id.toLowerCase() }),
      ...(v.reason === undefined ? {} : { p_reason: v.reason }),
      ...(v.member_reference === undefined ? {} : { p_member_reference: v.member_reference }),
    }),
    z.strictObject({ id: z.uuid(), status: z.literal("submitted") })
  );
}

const applicationUpdate = z.discriminatedUnion("action", [
  z.strictObject({ application_id: z.uuid(), action: z.literal("withdraw") }),
  z.strictObject({
    application_id: z.uuid(),
    action: z.literal("respond"),
    response: text(2, 2000, true),
  }),
]);
/** Returns null for a missing or someone else's request. */
export async function updateMyFoundationApplication(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const v = input(applicationUpdate, value);
  return settle(
    api.rpc("update_my_application", {
      p_application: v.application_id.toLowerCase(),
      p_action: v.action,
      ...(v.action === "respond" ? { p_response: v.response } : {}),
    }),
    z.strictObject({ id: z.uuid(), status: z.enum(["submitted", "withdrawn"]) }).nullable()
  );
}

const applicationStatus = z.enum([
  "submitted",
  "more_info_required",
  "approved",
  "declined",
  "withdrawn",
]);
const links = z.strictObject({
  applications: z.array(
    z.strictObject({
      id: z.uuid(),
      organisation_name: z.string(),
      organisation_slug: slug,
      post_id: z.uuid(),
      post_title: z.string().nullable(),
      status: applicationStatus,
      info_request: z.string().nullable(),
      created_at: instant,
      updated_at: instant,
    })
  ),
  affiliations: z.array(
    z.strictObject({
      id: z.uuid(),
      organisation_name: z.string(),
      organisation_slug: slug,
      post_id: z.uuid(),
      post_title: z.string().nullable(),
      label: z.string(),
      confirmed_at: instant,
    })
  ),
  administers: z.array(
    z.strictObject({
      organisation_id: z.uuid(),
      organisation_name: z.string(),
      organisation_slug: slug,
      role: z.enum(["owner", "admin"]),
    })
  ),
});
export async function readFoundationOrganisationLinks(api: FoundationAuthenticatedApi) {
  return settle(api.rpc("my_organisation_links"), links);
}

// ── Organisation administrator ──────────────────────────────────────────

const reviewItem = z.strictObject({
  id: z.uuid(),
  status: applicationStatus,
  post_id: z.uuid(),
  business_name: z.string().nullable(),
  category: key,
  province: key.nullable(),
  city: key.nullable(),
  identity_verified: z.boolean(),
  representative_name: z.string().nullable(),
  programme_name: z.string().nullable(),
  reason: z.string().nullable(),
  member_reference: z.string().nullable(),
  info_request: z.string().nullable(),
  info_response: z.string().nullable(),
  submitted_at: instant,
  decision_at: instant.nullable(),
  decision_note: z.string().nullable(),
});
export async function readFoundationOrganisationApplications(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const v = input(
    z.strictObject({ organisation_id: z.uuid(), status: applicationStatus.optional() }),
    value
  );
  return settle(
    api.rpc("org_list_applications", {
      p_org: v.organisation_id.toLowerCase(),
      ...(v.status === undefined ? {} : { p_status: v.status }),
    }),
    z.array(reviewItem).max(200)
  );
}

const decision = z.strictObject({
  application_id: z.uuid(),
  decision: z.enum(["approve", "decline", "request_info"]),
  note: text(1, 1000, true).optional(),
});
export async function decideFoundationApplication(api: FoundationAuthenticatedApi, value: unknown) {
  const v = input(decision, value);
  return settle(
    api.rpc("org_decide_application", {
      p_application: v.application_id.toLowerCase(),
      p_decision: v.decision,
      ...(v.note === undefined ? {} : { p_note: v.note }),
    }),
    z.strictObject({
      id: z.uuid(),
      decision: z.enum(["approve", "decline", "request_info"]),
      affiliation_id: z.uuid().nullable(),
    })
  );
}

const affiliationItem = z.strictObject({
  id: z.uuid(),
  post_id: z.uuid(),
  business_name: z.string().nullable(),
  category: key,
  province: key.nullable(),
  city: key.nullable(),
  live: z.boolean(),
  affiliation_type: z.enum(["participant", "member", "affiliate"]),
  programme_name: z.string().nullable(),
  confirmed_at: instant,
});
export async function readFoundationOrganisationAffiliations(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const { organisation_id } = input(z.strictObject({ organisation_id: z.uuid() }), value);
  return settle(
    api.rpc("org_list_affiliations", { p_org: organisation_id.toLowerCase() }),
    z.array(affiliationItem).max(500)
  );
}

const affiliationUpdate = z.discriminatedUnion("action", [
  z.strictObject({
    affiliation_id: z.uuid(),
    action: z.literal("revoke"),
    reason: text(5, 500, true),
  }),
  z.strictObject({
    affiliation_id: z.uuid(),
    action: z.literal("set_type"),
    affiliation_type: z.enum(["participant", "member", "affiliate"]),
  }),
]);
export async function updateFoundationAffiliation(api: FoundationAuthenticatedApi, value: unknown) {
  const v = input(affiliationUpdate, value);
  return settle(
    api.rpc("org_update_affiliation", {
      p_affiliation: v.affiliation_id.toLowerCase(),
      p_action: v.action,
      p_value: v.action === "revoke" ? v.reason : v.affiliation_type,
    }),
    z.strictObject({
      id: z.uuid(),
      status: z.enum(["active", "revoked", "ended"]),
      affiliation_type: z.enum(["participant", "member", "affiliate"]),
    })
  );
}

// ── Staff (organisation:manage, recent second factor) ───────────────────

export const staffReason = text(5, 500, true);
/** Staff invitation: the token is generated here and must be emailed by the
 * caller; only its hash is stored. Never log or return it to the browser. */
export async function inviteFoundationOrganisationAdmin(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const v = input(
    z.strictObject({
      organisation_id: z.uuid(),
      email: z
        .string()
        .max(254)
        .transform((x) => x.trim().toLowerCase())
        .refine((x) => /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(?:[.][a-z0-9-]+)*[.][a-z]{2,63}$/.test(x)),
      reason: staffReason,
    }),
    value
  );
  const token = createFoundationInviteToken();
  const invite = await settle(
    api.rpc("invite_organisation_admin", {
      p_org: v.organisation_id.toLowerCase(),
      p_email: v.email,
      p_token_hash: await hashFoundationInviteToken(token),
      p_reason: v.reason,
    }),
    z.strictObject({ invite_id: z.uuid(), expires_at: instant, organisation_name: z.string() })
  );
  return { ...invite, token };
}

export async function createFoundationOrganisation(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const v = input(
    z.strictObject({
      slug,
      name: text(2, 160, false),
      organisation_type: organisationType,
      reason: staffReason,
    }),
    value
  );
  return settle(
    api.rpc("create_organisation", {
      p_slug: v.slug,
      p_name: v.name,
      p_type: v.organisation_type,
      p_reason: v.reason,
    }),
    z.strictObject({ id: z.uuid(), slug, revision: z.number().int().min(1) })
  );
}

const patch = z
  .strictObject({
    name: text(2, 160, false),
    organisation_type: organisationType,
    description: text(1, 2000, true).nullable(),
    programme_description: text(1, 2000, true).nullable(),
    service_area: text(2, 120, false).nullable(),
    province_id: key.nullable(),
    website: z
      .string()
      .max(300)
      .regex(/^https:[/][/]/)
      .nullable(),
    public_email: z.string().max(254).nullable(),
    public_phone: z
      .string()
      .regex(/^[+]27[0-9]{9}$/)
      .nullable(),
    programme_status: programmeStatus,
    affiliation_wording: text(3, 60, false),
    sponsorship_wording: text(3, 60, false),
    is_public: z.boolean(),
    accepting_applications: z.boolean(),
    show_on_strip: z.boolean(),
    show_on_home: z.boolean(),
    sponsored_capacity: z.number().int().min(0).max(100000),
    admin_limit: z.number().int().min(1).max(50),
    display_order: z.number().int().min(0).max(100000),
    programme_starts_at: instant.nullable(),
    programme_ends_at: instant.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
/** Whole-record revision fence; SQL revalidates every field. */
export async function updateFoundationOrganisation(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const v = input(
    z.strictObject({
      id: z.uuid(),
      expected_revision: z.number().int().min(1).max(2147483646),
      patch,
      reason: staffReason,
    }),
    value
  );
  return settle(
    api.rpc("update_organisation", {
      p_id: v.id.toLowerCase(),
      p_expected_revision: v.expected_revision,
      p_patch: v.patch,
      p_reason: v.reason,
    }),
    z.strictObject({ id: z.uuid(), slug, revision: z.number().int().min(2) })
  );
}
