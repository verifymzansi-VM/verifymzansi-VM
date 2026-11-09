import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationPublicApi } from "./public-api";
import { FoundationStaffCommandError, settleStaffCommand } from "./staff-command";
import { readFrontendStaffClaims } from "./staff-claims";
import { PREMISES_TYPES } from "../business-verification/seen";
const date = z.iso.datetime({ offset: true });
const method = z.enum(["video", "visit"]);
const state = z.enum(["pending", "info_requested", "approved", "rejected", "withdrawn", "revoked"]);
const businessKind = z.enum(["seen", "cipc", "cipc_link"]);
const cipcRoute = z.enum(["director", "representative"]);
const registration = z.string().regex(/^\d{4}\/\d{6}\/\d{2}$/);
const position = z.enum(["director", "member", "representative"]);
export const registeredOffice = z.object({
  suburb: z.string().max(120).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  province: z.string().max(80).nullable().optional(),
  streetLines: z.array(z.string().max(240)).max(6).optional(),
  postalCode: z.string().max(12).nullable().optional(),
  cityKnown: z.boolean().optional(),
});
const seen = z.strictObject({
  verifiedAt: date,
  expiresAt: date,
  method,
  city: z.string().max(80).nullable(),
});
async function readPublicBusinessSeen(api: FoundationPublicApi, ids: string[], withExpiry = false) {
  if (!ids.length)
    return new Map<
      string,
      {
        seen_verified_at: string;
        seen_expires_at?: string;
        seen_method: "video" | "visit";
        seen_city: string | null;
      }
    >();
  const allowed = new Set(z.array(z.uuid()).max(100).parse(ids));
  const { data, error } = await api.rpc(
    "get_public_frontend_business_seen",
    { p_post_ids: [...allowed] },
    { get: false }
  );
  if (error) throw new Error("Current business stickers could not be loaded");
  const items = z
    .array(
      z.strictObject({
        business_id: z.uuid(),
        verified_at: date,
        expires_at: date,
        method,
        city: z.string().max(80).nullable(),
      })
    )
    .max(100)
    .parse(data);
  if (
    items.some((item) => !allowed.has(item.business_id)) ||
    new Set(items.map((i) => i.business_id)).size !== items.length
  )
    throw new Error("Business sticker response changed");
  return new Map(
    items.map((item) => [
      item.business_id,
      {
        seen_verified_at: item.verified_at,
        ...(withExpiry ? { seen_expires_at: item.expires_at } : {}),
        seen_method: item.method,
        seen_city: item.city,
      },
    ])
  );
}

/** Current public CIPC and Seen stickers per business. `withExpiry` also returns
 * cipc_expires_at and seen_expires_at, for callers that recheck expiry with
 * toPublicVerification. */
export async function readPublicBusinessStickers(
  api: FoundationPublicApi,
  ids: string[],
  { withExpiry = false }: { withExpiry?: boolean } = {}
) {
  if (!ids.length) return new Map<string, object>();
  const allowed = new Set(z.array(z.uuid()).max(100).parse(ids));
  const [seen, cipc] = await Promise.all([
    readPublicBusinessSeen(api, [...allowed], withExpiry),
    api.rpc("get_public_frontend_business_cipc", { p_post_ids: [...allowed] }, { get: false }),
  ]);
  if (cipc.error) throw new Error("Current CIPC stickers could not be loaded");
  const items = z
    .array(
      z.strictObject({
        business_id: z.uuid(),
        verified_at: date,
        expires_at: date,
        registration_number: registration,
        registered_name: z.string().max(250),
        role: position,
        position: z.string().max(120).nullable(),
        office: registeredOffice.nullable(),
      })
    )
    .max(100)
    .parse(cipc.data);
  if (
    items.some((item) => !allowed.has(item.business_id)) ||
    new Set(items.map((i) => i.business_id)).size !== items.length
  )
    throw new Error("Business sticker response changed");
  const results = new Map<string, object>(seen);
  for (const item of items)
    results.set(item.business_id, {
      ...results.get(item.business_id),
      cipc_verified_at: item.verified_at,
      ...(withExpiry ? { cipc_expires_at: item.expires_at } : {}),
      cipc_registration_number: item.registration_number,
      cipc_registered_name: item.registered_name,
      cipc_registered_office: item.office,
      owner_verified_role: item.role,
      owner_position_title: item.position,
    });
  return results;
}

export async function readMyBusinessChecks(api: FoundationAuthenticatedApi, businessId: string) {
  const response = await api.rpc(
    "get_my_frontend_business_review_state",
    { p_business: businessId },
    { get: false }
  );
  if (response.error?.code === "PT404")
    throw new FoundationStaffCommandError(404, "This business is not available on your account.");
  return settleStaffCommand(
    Promise.resolve(response),
    z.strictObject({
      business: z.strictObject({ id: z.literal(businessId), name: z.string().nullable() }),
      stickers: z.strictObject({
        idReviewed: z.boolean(),
        seen: seen.nullable(),
        cipc: z
          .strictObject({
            verifiedAt: date,
            expiresAt: date,
            registrationNumber: registration,
            registeredName: z.string().max(250),
            role: position,
            position: z.string().max(120).nullable(),
            showFullRegisteredOffice: z.boolean(),
            registeredOffice: registeredOffice.nullable(),
          })
          .nullable(),
      }),
      cases: z
        .array(
          z.strictObject({
            id: z.uuid(),
            kind: businessKind,
            status: state,
            route: cipcRoute.nullable(),
            registrationNumber: registration.nullable(),
            reasonCode: z.string().max(80).nullable(),
            note: z.string().max(1000).nullable(),
            createdAt: date,
            decidedAt: date.nullable(),
            expiresAt: date.nullable(),
            seenMethod: method.nullable(),
            seenScheduledFor: date.nullable(),
            representative: z
              .strictObject({
                email: z.email().max(254).nullable(),
                position: z.string().max(40).nullable(),
                emailVerified: z.boolean(),
                codeSent: z.boolean(),
              })
              .nullable(),
            messages: z
              .array(
                z.strictObject({
                  id: z.uuid(),
                  from: z.enum(["You", "VerifyMzansi team"]),
                  mine: z.boolean(),
                  body: z.string().max(2000),
                  createdAt: date,
                })
              )
              .max(100),
          })
        )
        .max(20),
      linkable: z
        .array(
          z.strictObject({
            businessId: z.uuid(),
            businessName: z.string(),
            registrationNumber: registration,
            registeredName: z.string().max(250),
          })
        )
        .max(100),
    })
  );
}

export async function currentBusinessClaim(
  api: FoundationAuthenticatedApi,
  actor: string,
  id: string,
  required: boolean
) {
  const result = await readFrontendStaffClaims(api, [{ type: "business_verification", id }]);
  if (result.account_id !== actor)
    throw new FoundationStaffCommandError(503, "The staff session changed.");
  const claim = result.items.find(
    (x) => x.item_type === "business_verification" && x.id === id && x.mine
  );
  if (required && (!claim?.generation || !claim.nonce))
    throw new FoundationStaffCommandError(409, "Claim this business check before continuing.");
  return claim?.generation && claim.nonce
    ? { generation: claim.generation, nonce: claim.nonce }
    : null;
}

const count = z.number().int().nonnegative();
const row = z.strictObject({
  id: z.uuid(),
  kind: businessKind,
  route: cipcRoute.nullable(),
  status: state,
  businessId: z.uuid(),
  businessName: z.string(),
  ownerName: z.string(),
  registrationNumber: registration.nullable(),
  red: count,
  amber: count,
  createdAt: date,
  updatedAt: date,
  exceptionPending: z.boolean(),
  conflict: z.boolean(),
  renewal: z.boolean(),
});
export function readStaffSeenQueue(api: FoundationAuthenticatedApi, actor: string, tab: string) {
  return settleStaffCommand(
    api.rpc("get_frontend_business_review_queue", { p_tab: tab }, { get: false }),
    z.strictObject({
      actor_id: z.literal(actor),
      counts: z.strictObject({
        review: count,
        representatives: count,
        visits: count,
        conflicts: count,
        renewals: count,
        exceptions: count,
        waiting: count,
        decided: z.null(),
      }),
      rows: z.array(row).max(200),
    })
  );
}

export const visitPhotoReceipt = z.strictObject({
  fileId: z.uuid(),
  by: z.uuid().nullable(),
  takenAt: date,
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
});
const visitReport = z.strictObject({
  by: z.uuid().nullable(),
  at: date,
  outcome: z.enum(["seen", "not_confirmed"]),
  identityConfirmed: z.boolean(),
  signage: z.boolean(),
  productsSeen: z.string().max(500),
  premisesType: z.enum(PREMISES_TYPES),
  notes: z.string().max(1000).nullable(),
  city: z.string().max(80).nullable(),
});
export function readStaffSeenCase(api: FoundationAuthenticatedApi, id: string) {
  return settleStaffCommand(
    api.rpc("get_frontend_seen_case", { p_case: id }, { get: false }),
    z
      .strictObject({
        id: z.literal(id),
        ownerId: z.uuid(),
        kind: z.literal("seen"),
        status: state,
        createdAt: date,
        updatedAt: date,
        decidedAt: date.nullable(),
        expiresAt: date.nullable(),
        reviewNote: z.string().max(1000).nullable(),
        reasonCode: z.string().max(80).nullable(),
        business: z.strictObject({
          id: z.uuid(),
          business_name: z.string().nullable(),
          slug: z.string().nullable(),
          status: z.string(),
          location_city: z.string().nullable(),
          location_province: z.string().nullable(),
        }),
        owner: z.strictObject({
          displayName: z.string().nullable(),
          legalName: z.string().nullable(),
          idReviewed: z.boolean(),
        }),
        seen: z.strictObject({
          method,
          address: z.string().max(300).nullable(),
          slots: z.array(z.string().max(80)).max(3).nullable(),
          assignedTo: z.uuid().nullable(),
          scheduledFor: date.nullable(),
          photos: z.array(visitPhotoReceipt).max(12),
          report: visitReport.nullable(),
        }),
        files: z
          .array(
            z.strictObject({
              id: z.uuid(),
              kind: z.enum(["visit_photo", "message_attachment"]),
              content_type: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
              size_bytes: z.number().int().positive(),
              created_at: date,
              quarantined: z.literal(false),
              purged_at: date.nullable(),
            })
          )
          .max(32),
        messages: z
          .array(
            z.strictObject({
              id: z.uuid(),
              author_id: z.uuid().nullable(),
              author_role: z.enum(["owner", "staff"]),
              body: z.string().max(2000),
              created_at: date,
              attachment_file_id: z.uuid().nullable(),
            })
          )
          .max(100),
      })
      .nullable()
  );
}
