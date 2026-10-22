import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationPublicApi } from "./public-api";
import { input, instant, key, objectKey, settle, slug, staffReason, text } from "./organisations";

const sponsorshipStatus = z.enum(["active", "waitlisted", "ended", "revoked"]);
const sponsorType = z.enum(["founding", "organisation"]);
const placement = z.enum(["home", "business", "tourism", "market"]);
const reason = text(5, 500, true);

// ── Public ──────────────────────────────────────────────────────────────

/** "Supported by" badges for up to 100 live business posts. */
export async function readFoundationPostSponsorships(api: FoundationPublicApi, value: unknown) {
  const { post_ids } = input(
    z.strictObject({ post_ids: z.array(z.uuid()).min(1).max(100) }),
    value
  );
  return settle(
    api.rpc("public_post_sponsorships", {
      p_post_ids: [...new Set(post_ids.map((id) => id.toLowerCase()))],
    }),
    z
      .array(
        z.strictObject({
          post_id: z.uuid(),
          organisation_slug: slug,
          organisation_name: z.string(),
          label: z.string(),
        })
      )
      .max(1000)
  );
}

const showcase = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  organisation_slug: slug,
  organisation_name: z.string(),
  cards: z
    .array(
      z.strictObject({
        post_id: z.uuid(),
        title: z.string().nullable(),
        city: key.nullable(),
        cover_object_key: objectKey,
        sponsored: z.boolean(),
      })
    )
    .min(3)
    .max(48),
});
/** At most two live programme spotlights for a page placement. */
export async function readFoundationProgrammeShowcases(api: FoundationPublicApi, value: unknown) {
  const v = input(z.strictObject({ placement }), value);
  return settle(
    api.rpc("public_programme_showcases", { p_placement: v.placement }),
    z.array(showcase).max(2)
  );
}

// ── Business owner ──────────────────────────────────────────────────────

export async function readMyFoundationSponsorships(api: FoundationAuthenticatedApi) {
  return settle(
    api.rpc("my_sponsorships"),
    z
      .array(
        z.strictObject({
          id: z.uuid(),
          post_id: z.uuid(),
          business_name: z.string().nullable(),
          organisation_slug: slug,
          organisation_name: z.string(),
          label: z.string(),
          status: sponsorshipStatus,
          starts_at: instant.nullable(),
          ends_at: instant.nullable(),
          ended_at: instant.nullable(),
        })
      )
      .max(100)
  );
}

// ── Organisation administrator (or staff with organisation:manage) ──────

export async function readFoundationOrganisationSponsorships(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const { organisation_id } = input(z.strictObject({ organisation_id: z.uuid() }), value);
  return settle(
    api.rpc("org_list_sponsorships", { p_org: organisation_id.toLowerCase() }),
    z.strictObject({
      capacity: z.number().int().min(0),
      programme_status: z.string(),
      active: z.number().int().min(0),
      waitlisted: z.number().int().min(0),
      items: z
        .array(
          z.strictObject({
            id: z.uuid(),
            affiliation_id: z.uuid(),
            post_id: z.uuid(),
            business_name: z.string().nullable(),
            sponsor_type: sponsorType,
            status: sponsorshipStatus,
            starts_at: instant.nullable(),
            ends_at: instant.nullable(),
            created_at: instant,
            ended_at: instant.nullable(),
            end_reason: z.string().nullable(),
          })
        )
        .max(500),
    })
  );
}

const sponsorshipChange = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("sponsor"), affiliation_id: z.uuid(), reason }),
  z.strictObject({ action: z.literal("end"), sponsorship_id: z.uuid(), reason }),
]);
/** Sponsor an affiliated business (a place, or the waiting list) or end a place. */
export async function changeFoundationSponsorship(api: FoundationAuthenticatedApi, value: unknown) {
  const v = input(sponsorshipChange, value);
  if (v.action === "sponsor")
    return settle(
      api.rpc("sponsor_business", {
        p_affiliation: v.affiliation_id.toLowerCase(),
        p_reason: v.reason,
      }),
      z.strictObject({
        id: z.uuid(),
        status: z.enum(["active", "waitlisted"]),
        sponsor_type: sponsorType,
        ends_at: instant.nullable(),
      })
    );
  return settle(
    api.rpc("end_sponsorship", {
      p_sponsorship: v.sponsorship_id.toLowerCase(),
      p_reason: v.reason,
    }),
    z.strictObject({ id: z.uuid(), status: z.literal("ended") })
  );
}

// ── Staff (organisation:manage, recent second factor) ───────────────────

const showcaseInput = z
  .strictObject({
    organisation_id: z.uuid(),
    showcase_id: z.uuid().nullable(),
    expected_revision: z.number().int().min(1).max(2147483646).nullable(),
    title: text(3, 120, false),
    placement,
    enabled: z.boolean(),
    starts_at: instant,
    ends_at: instant,
    max_cards: z.number().int().min(3).max(48),
    display_order: z.number().int().min(0).max(100000),
    sponsored_only: z.boolean(),
    province: key.optional(),
    city: key.optional(),
    programme_id: z.uuid().optional(),
    reason: staffReason,
  })
  .refine((v) => (v.showcase_id === null) === (v.expected_revision === null))
  .refine((v) => Date.parse(v.ends_at) > Date.parse(v.starts_at));
/** Creates (showcase_id null) or replaces a showcase; SQL revalidates all. */
export async function saveFoundationProgrammeShowcase(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const v = input(showcaseInput, value);
  return settle(
    api.rpc("save_programme_showcase", {
      p_org: v.organisation_id.toLowerCase(),
      p_title: v.title,
      p_placement: v.placement,
      p_enabled: v.enabled,
      p_starts_at: v.starts_at,
      p_ends_at: v.ends_at,
      p_max_cards: v.max_cards,
      p_display_order: v.display_order,
      p_sponsored_only: v.sponsored_only,
      p_reason: v.reason,
      ...(v.showcase_id === null
        ? {}
        : {
            p_showcase: v.showcase_id.toLowerCase(),
            p_expected_revision: v.expected_revision ?? 0,
          }),
      ...(v.province === undefined ? {} : { p_province: v.province }),
      ...(v.city === undefined ? {} : { p_city: v.city }),
      ...(v.programme_id === undefined ? {} : { p_programme: v.programme_id.toLowerCase() }),
    }),
    z.strictObject({ id: z.uuid(), revision: z.number().int().min(1) })
  );
}
