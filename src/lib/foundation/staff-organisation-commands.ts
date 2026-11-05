import "server-only";

import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  foundationOrganisationTypes,
  inviteFoundationOrganisationAdmin,
  slug,
  staffReason,
  text,
} from "./organisations";
import { saveFoundationProgrammeShowcase } from "./organisation-sponsorships";
import { foundationMediaUrl } from "./public-media-url";
import { readFrontendStaffOrganisationDetail } from "./staff-organisations";
import { readFoundationStaffShowcases } from "./staff-directory";
import { FoundationStaffCommandError, settleStaffCommand } from "./staff-command";
import reference from "../domains/taxonomy/reference.json";
import { sanitizeAppUrl } from "../services/email-template";
import { sendOrganisationAdminInviteEmail } from "../services/email";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || null)
    .optional();
const publicPhone = optionalText(32).transform((s) => {
  if (!s) return s;
  const digits = s.replace(/[ ()-]/g, "");
  return /^0[0-9]{9}$/.test(digits) ? `+27${digits.slice(1)}` : digits;
});
const profile = z.strictObject({
  slug,
  name: z.string().trim().min(2).max(160),
  organisationType: z.enum(foundationOrganisationTypes),
  description: optionalText(2000),
  programmeDescription: optionalText(2000),
  serviceArea: optionalText(120),
  province: optionalText(60),
  website: optionalText(300),
  publicEmail: optionalText(254),
  publicPhone,
  logoUrl: optionalText(400),
  affiliationWording: z.string().trim().min(3).max(60).optional(),
  sponsorshipWording: z.string().trim().min(3).max(60).optional(),
  isPublic: z.boolean().optional(),
  acceptingApplications: z.boolean().optional(),
  showOnStrip: z.boolean().optional(),
  showOnHome: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
  sponsoredCapacity: z.number().int().min(0).max(100000).optional(),
});

function provinceId(value: string | null | undefined) {
  if (!value) return value;
  const name = value.toLowerCase();
  const match = reference.provinces.find((p) =>
    [p.id, p.label.toLowerCase(), p.code.toLowerCase()].includes(name)
  );
  if (!match) throw new FoundationStaffCommandError(422, "Choose a South African province.");
  return match.id;
}

export async function saveFrontendStaffOrganisation(
  api: FoundationAuthenticatedApi,
  value: { organisationId?: string; revision?: number; values: unknown; reason: string }
) {
  const v = profile.parse(value.values);
  const id = value.organisationId;
  if (id) {
    if (!value.revision)
      throw new FoundationStaffCommandError(409, "Reload the organisation before saving.");
    if (v.logoUrl !== undefined) {
      const current = await readFrontendStaffOrganisationDetail(api, id);
      if (!current) throw new FoundationStaffCommandError(404, "Organisation could not be found.");
      if (v.logoUrl !== foundationMediaUrl(current.logo_object_key))
        throw new FoundationStaffCommandError(
          422,
          "Record or withdraw logo permission using Programme actions."
        );
    }
  }
  const result = await settleStaffCommand(
    api.rpc(
      "save_frontend_organisation_profile",
      {
        p_slug: v.slug,
        p_reason: staffReason.parse(value.reason),
        p_patch: {
          name: v.name,
          organisation_type: v.organisationType,
          description: v.description,
          programme_description: v.programmeDescription,
          service_area: v.serviceArea,
          province_id: provinceId(v.province),
          website: v.website,
          public_email: v.publicEmail,
          public_phone: v.publicPhone,
          affiliation_wording: v.affiliationWording,
          sponsorship_wording: v.sponsorshipWording,
          is_public: v.isPublic,
          accepting_applications: v.acceptingApplications,
          show_on_strip: v.showOnStrip,
          show_on_home: v.showOnHome,
          display_order: v.displayOrder,
          sponsored_capacity: v.sponsoredCapacity,
        },
        ...(id ? { p_id: id, p_expected: value.revision } : {}),
      },
      { get: false }
    ),
    z.strictObject({
      id: id ? z.literal(id) : z.uuid(),
      slug: z.literal(v.slug),
      revision: z.number().int().min(2),
    })
  );
  return result.id;
}

export async function inviteFrontendStaffOrganisationAdmin(
  api: FoundationAuthenticatedApi,
  value: { organisationId: string; email: string; reason: string }
) {
  const org = await readFrontendStaffOrganisationDetail(api, value.organisationId);
  if (!org) throw new FoundationStaffCommandError(404, "Organisation could not be found.");
  const invite = await inviteFoundationOrganisationAdmin(api, {
    organisation_id: org.id,
    email: value.email,
    reason: value.reason,
  });
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const sent = await sendOrganisationAdminInviteEmail({
    email: value.email.trim().toLowerCase(),
    organisationName: invite.organisation_name,
    acceptUrl: `${appUrl}/organisation-invite?token=${encodeURIComponent(invite.token)}`,
    expiresAt: invite.expires_at,
    idempotencyKey: `organisation-invite/${invite.invite_id}`,
  });
  if (!sent.success) {
    await revokeFrontendStaffOrganisationInvite(
      api,
      invite.invite_id,
      "Invitation email could not be delivered"
    );
    throw new FoundationStaffCommandError(
      503,
      "The invitation email could not be sent. Please try again."
    );
  }
  return { inviteId: invite.invite_id, expiresAt: invite.expires_at };
}

export function revokeFrontendStaffOrganisationInvite(
  api: FoundationAuthenticatedApi,
  id: string,
  reason: string
) {
  return settleStaffCommand(
    api.rpc("revoke_organisation_invite", { p_invite: id, p_reason: reason }, { get: false }),
    z.strictObject({ invite_id: z.literal(id), revoked: z.literal(true) })
  );
}

export async function manageFrontendStaffOrganisation(
  api: FoundationAuthenticatedApi,
  command: {
    organisationId: string;
    revision?: number;
    operation: string;
    values: Record<string, unknown>;
    reason: string;
  }
) {
  const id = command.organisationId;
  const reason = staffReason.parse(command.reason);
  switch (command.operation) {
    case "remove_admin": {
      const { userId } = z.strictObject({ userId: z.uuid() }).parse(command.values);
      return settleStaffCommand(
        api.rpc(
          "remove_organisation_admin",
          { p_org: id, p_account: userId, p_reason: reason },
          { get: false }
        ),
        z.strictObject({ removed: z.literal(true) })
      );
    }
    case "set_capacity":
    case "suspend":
    case "end_trial":
    case "reinstate": {
      if (!command.revision)
        throw new FoundationStaffCommandError(
          409,
          "Reload the organisation before applying this change."
        );
      const patch =
        command.operation === "set_capacity"
          ? {
              sponsored_capacity: z
                .number()
                .int()
                .min(0)
                .max(100000)
                .parse(command.values.sponsoredCapacity),
            }
          : {
              programme_status:
                command.operation === "suspend"
                  ? "suspended"
                  : z.enum(["affiliation_only", "ended"]).parse(command.values.status),
            };
      return settleStaffCommand(
        api.rpc(
          "update_organisation",
          {
            p_id: id,
            p_expected_revision: command.revision,
            p_patch: patch,
            p_reason: reason,
          },
          { get: false }
        ),
        z.strictObject({ id: z.literal(id), slug, revision: z.number().int().min(2) })
      );
    }
    case "revoke_logo":
    case "approve_logo": {
      if (!command.revision)
        throw new FoundationStaffCommandError(
          409,
          "Reload the organisation before recording logo permission."
        );
      const org = await readFrontendStaffOrganisationDetail(api, id);
      if (!org) throw new FoundationStaffCommandError(404, "Organisation could not be found.");
      const grant = command.operation === "approve_logo";
      if (grant && !org.logo_object_id)
        throw new FoundationStaffCommandError(409, "An uploaded organisation logo is required.");
      return settleStaffCommand(
        api.rpc(
          "set_organisation_logo",
          {
            p_id: id,
            p_expected_revision: command.revision,
            p_reason: reason,
            ...(grant && org.logo_object_id
              ? {
                  p_object_id: org.logo_object_id,
                  p_permission_reference: text(3, 200, false).parse(command.values.reference),
                }
              : {}),
          },
          { get: false }
        ),
        z.strictObject({ id: z.literal(id), slug, revision: z.number().int().min(2) })
      );
    }
    case "add_programme":
    case "update_programme": {
      const value = z
        .strictObject({
          slug,
          name: text(2, 160, false),
          description: optionalText(2000),
          active: z.boolean().optional(),
        })
        .parse(command.values);
      return settleStaffCommand(
        api.rpc(
          "save_organisation_programme",
          {
            p_org: id,
            p_slug: value.slug,
            p_name: value.name,
            p_reason: reason,
            p_description: value.description ?? undefined,
            p_active: value.active ?? true,
          },
          { get: false }
        ),
        z.strictObject({ id: z.uuid(), slug: z.literal(value.slug), active: z.boolean() })
      );
    }
    case "upsert_showcase":
      return saveShowcase(api, id, reason, command.values);
    default:
      throw new FoundationStaffCommandError(
        501,
        "This action is not yet available on the new backend."
      );
  }
}

async function saveShowcase(
  api: FoundationAuthenticatedApi,
  id: string,
  reason: string,
  values: Record<string, unknown>
) {
  if (values.showcaseId !== undefined) {
    const v = z
      .strictObject({
        showcaseId: z.uuid(),
        enabled: z.boolean(),
        revision: z.number().int().positive(),
      })
      .parse(values);
    const row = (await readFoundationStaffShowcases(api, { organisation_id: id })).find(
      (item) => item.id === v.showcaseId
    );
    if (!row || row.revision !== v.revision)
      throw new FoundationStaffCommandError(409, "Reload the showroom before changing it.");
    return saveFoundationProgrammeShowcase(api, {
      organisation_id: id,
      showcase_id: row.id,
      expected_revision: v.revision,
      title: row.title,
      placement: row.placement,
      enabled: v.enabled,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      max_cards: row.max_cards,
      display_order: row.display_order,
      sponsored_only: row.sponsored_only,
      province: row.province ?? undefined,
      city: row.city ?? undefined,
      programme_id: row.programme_id ?? undefined,
      reason,
    });
  }
  const v = z
    .strictObject({
      title: text(3, 120, false),
      placement: z.enum(["home", "business", "tourism", "market"]),
      enabled: z.boolean(),
      endsAt: z.iso.datetime(),
      maxCards: z.number().int().min(3).max(48).optional(),
      displayOrder: z.number().int().min(0).max(100000).optional(),
      province: optionalText(60),
      city: optionalText(80),
      sponsoredOnly: z.boolean(),
    })
    .parse(values);
  const province = provinceId(v.province);
  const cityName = v.city?.toLowerCase();
  const cities = cityName
    ? reference.cities.filter(
        (row) =>
          (!province || province === row.province) &&
          [row.id, row.label, ...row.aliases].some((name) => name.toLowerCase() === cityName)
      )
    : [];
  if (cityName && cities.length !== 1)
    throw new FoundationStaffCommandError(422, "Choose a city in the selected province.");
  return saveFoundationProgrammeShowcase(api, {
    organisation_id: id,
    showcase_id: null,
    expected_revision: null,
    title: v.title,
    placement: v.placement,
    enabled: v.enabled,
    starts_at: new Date().toISOString(),
    ends_at: v.endsAt,
    max_cards: v.maxCards ?? 12,
    display_order: v.displayOrder ?? 100,
    sponsored_only: v.sponsoredOnly,
    province: province ?? cities[0]?.province,
    city: cities[0]?.id,
    reason,
  });
}
