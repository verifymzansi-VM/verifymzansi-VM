import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { settleStaffCommand } from "./staff-command";
import { registeredOffice } from "./business-seen";
import type { CaseDetail } from "../business-verification/admin-queries";
import { compareWithAdminCopy, suggestNextStep, type Finding } from "../cipc/screen";

const instant = z.iso.datetime({ offset: true });
const text = z.string().nullable();
const director = z.strictObject({
  name: z.string().max(250),
  role: text,
  hasSaId: z.boolean(),
  isOwner: z.boolean(),
});
const summary = z.object({
  registrationNumber: text,
  registeredName: text,
  enterpriseStatus: text,
  issuedOn: text,
  docType: text,
  registeredOfficeLines: z.array(z.string().max(500)).max(30),
  registeredOffice: registeredOffice.nullable(),
  directors: z.array(director).max(100),
  cipcReference: z.string().max(80).optional(),
});
const detail = (id: string) =>
  z.strictObject({
    id: z.literal(id),
    ownerId: z.uuid(),
    kind: z.enum(["cipc", "cipc_link"]),
    route: z.enum(["director", "representative"]),
    status: z.enum(["pending", "info_requested", "approved", "rejected", "withdrawn", "revoked"]),
    registrationNumber: z.string().regex(/^\d{4}\/\d{6}\/\d{2}$/),
    createdAt: instant,
    updatedAt: instant,
    decidedAt: instant.nullable(),
    expiresAt: instant.nullable(),
    reasonCode: text,
    reviewNote: text,
    business: z.strictObject({
      id: z.uuid(),
      business_name: text,
      slug: text,
      status: z.string(),
      location_city: text,
      location_province: text,
    }),
    owner: z.strictObject({ displayName: text, legalName: text, idReviewed: z.boolean() }),
    parsed: summary.nullable(),
    official: summary.nullable(),
    office: registeredOffice.nullable(),
    representative: z
      .strictObject({
        email: z.email().nullable(),
        position: text,
        emailVerifiedAt: instant.nullable(),
        domainConfirmed: z.boolean(),
        callback: z
          .strictObject({
            numberSource: z.string(),
            spokeTo: z.string(),
            confirmedPosition: z.string(),
            confirmed: z.boolean(),
            notes: text,
            by: z.uuid(),
            at: instant,
          })
          .nullable(),
        confirmed: z.boolean(),
      })
      .nullable(),
    exception: z
      .strictObject({
        proposedBy: z.uuid(),
        confirmedBy: z.uuid().nullable(),
        reason: z.string().max(1000),
      })
      .nullable(),
    evidence: z.strictObject({
      ready: z.boolean(),
      missing: z.array(z.string()).max(12),
      unwaivable: z.array(z.string()).max(12),
      role: z.enum(["director", "member", "representative"]).nullable(),
      position: text,
      registeredName: text,
    }),
    files: z
      .array(
        z.strictObject({
          id: z.uuid(),
          kind: z.enum(["owner_upload", "admin_copy"]),
          content_type: z.literal("application/pdf"),
          size_bytes: z.number().int().positive(),
          created_at: instant,
          quarantined: z.literal(false),
          purged_at: instant.nullable(),
        })
      )
      .max(20),
    messages: z
      .array(
        z.strictObject({
          id: z.uuid(),
          author_id: z.uuid().nullable(),
          author_role: z.enum(["owner", "staff"]),
          body: z.string().max(2000),
          created_at: instant,
          attachment_file_id: z.uuid().nullable(),
        })
      )
      .max(100),
    accessLog: z
      .array(z.strictObject({ actor_id: z.uuid(), action: z.string(), created_at: instant }))
      .max(10),
  });

export async function readStaffCipcCase(
  api: FoundationAuthenticatedApi,
  id: string
): Promise<CaseDetail> {
  const data = await settleStaffCommand(
    api.rpc("get_frontend_cipc_case", { p_case: id }, { get: false }),
    detail(id).nullable()
  );
  if (!data) return null;
  const { parsed, official } = data;
  const names = (items: Array<z.infer<typeof director>>) =>
    items.map((p) => [p.name.trim().toLowerCase(), p.role?.trim().toLowerCase() ?? ""].join("|"));
  const differences =
    parsed && official
      ? compareWithAdminCopy(parsed, official, names(parsed.directors), names(official.directors))
      : [];
  const findings: Finding[] = differences.map((difference) => ({
    code: "official_copy_difference",
    severity:
      difference.field === "Registration number" || difference.field === "Status"
        ? "attention"
        : "check",
    title: `${difference.field} differs from the official copy`,
    detail: "Review the comparison with the separately fetched official disclosure.",
  }));
  const fullOffice = (office: z.infer<typeof registeredOffice> | null) =>
    office
      ? {
          streetLines: office.streetLines ?? [],
          suburb: office.suburb ?? null,
          city: office.city ?? null,
          province: office.province ?? null,
          postalCode: office.postalCode ?? null,
          cityKnown: office.cityKnown ?? false,
        }
      : null;
  const people = (items: Array<z.infer<typeof director>>) =>
    items.map((item) => ({ ...item, nameMatch: null }));
  return {
    ...data,
    docType: parsed?.docType ?? null,
    business: {
      ...data.business,
      cipc_verified_at: data.status === "approved" ? data.decidedAt : null,
      cipc_registration_number: data.status === "approved" ? data.registrationNumber : null,
    },
    owner: { ...data.owner, hasIdHash: data.owner.idReviewed },
    parsed: {
      registeredName: parsed?.registeredName ?? null,
      registrationNumber: parsed?.registrationNumber ?? null,
      enterpriseStatus: parsed?.enterpriseStatus ?? null,
      issuedOn: parsed?.issuedOn ?? null,
      registeredOfficeLines: parsed?.registeredOfficeLines ?? [],
      directors: people(parsed?.directors ?? []),
    },
    ownerMatchOnUpload: parsed?.directors.find((p) => p.isOwner)?.name ?? null,
    adminCopy: official
      ? {
          registrationNumber: official.registrationNumber,
          registeredName: official.registeredName,
          enterpriseStatus: official.enterpriseStatus,
          directors: people(official.directors),
          registeredOffice: fullOffice(official.registeredOffice),
          registeredOfficeLines: official.registeredOfficeLines,
          cipcReference: official.cipcReference ?? null,
          differences,
        }
      : null,
    registeredOffice: data.office,
    seen: null,
    checks: data.exception
      ? {
          exception: {
            proposedBy: data.exception.proposedBy,
            reason: data.exception.reason,
            ...(data.exception.confirmedBy ? { confirmedBy: data.exception.confirmedBy } : {}),
          },
        }
      : null,
    findings,
    suggestion: suggestNextStep(findings, Boolean(official)),
    files: data.files.map((file) => ({ ...file, producer: null, revision_count: null })),
  };
}
