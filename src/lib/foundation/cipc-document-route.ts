import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readBoundedRequestFormData } from "../utils/request-body";
import { isIntakeError, readCipcFile, type CipcFile } from "../business-verification/intake";
import { ownerPreview } from "../business-verification/service";
import { normaliseRegistrationNumber } from "../cipc/parse";
import { officeToLocation } from "../cipc/address";
import { sourceIdentityDigestToFingerprint } from "../domains/verification/identity-fingerprint";
import { createFoundationServiceApi } from "./service-api";
import { currentBusinessClaim, readMyBusinessChecks } from "./business-seen";
import { protectBusinessEvidenceRoute, storeBusinessEvidence } from "./business-evidence-route";
import { FoundationStaffCommandError, settleStaffCommand } from "./staff-command";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const reserved = z.strictObject({
  case_id: z.uuid(),
  artifact_id: z.uuid(),
  owner_id: z.uuid(),
  completed: z.boolean(),
});
const date = z.iso.datetime({ offset: true });
const accepted = z.strictObject({
  caseId: z.uuid(),
  status: z.literal("pending"),
  updatedAt: date,
});
const fileHash = (file: CipcFile) => createHash("sha256").update(file.bytes).digest("hex");

async function cipcForm(request: Request, allowed: readonly string[]) {
  const form = await readBoundedRequestFormData(request, 6 * 1024 * 1024);
  if ([...form.keys()].some((name) => !allowed.includes(name) || form.getAll(name).length !== 1))
    return NextResponse.json(
      { error: "Check the CIPC file and request details." },
      { status: 400 }
    );
  const upload = form.get("file");
  if (!(upload instanceof File))
    return NextResponse.json({ error: "Choose a CIPC PDF." }, { status: 400 });
  const file = await readCipcFile(upload, { pdfOnly: true });
  if (isIntakeError(file))
    return NextResponse.json({ error: file.error, code: file.code }, { status: file.status });
  if (file.activeContent)
    return NextResponse.json(
      {
        error: "This PDF contains active content. Download it again from CIPC.",
        code: "active_pdf",
      },
      { status: 422 }
    );
  return { form, file };
}

async function recordCipcFile(
  caller: { accountId: string; sessionId: string },
  receipt: z.infer<typeof reserved>,
  file: CipcFile,
  reference?: string
) {
  if (receipt.completed) return;
  await storeBusinessEvidence(receipt, receipt.case_id, Buffer.from(file.bytes), "registration");
  const parsed = file.stored;
  await settleStaffCommand(
    createFoundationServiceApi().rpc(
      "record_frontend_cipc_parse",
      {
        p_actor: caller.accountId,
        p_session: caller.sessionId,
        p_artifact: receipt.artifact_id,
        p_summary: {
          registrationNumber: parsed?.registrationNumber ?? null,
          registeredName: parsed?.registeredName ?? null,
          enterpriseStatus: parsed?.enterpriseStatus ?? null,
          issuedOn: parsed?.issuedOn ?? null,
          docType: parsed?.docType ?? null,
          registeredOffice: file.office ?? null,
          registeredOfficeLines: parsed?.registeredOfficeLines ?? [],
          ...(reference ? { cipcReference: reference } : {}),
        },
        p_directors: (parsed?.directors ?? []).map((person) => ({
          name: person.name,
          role: person.role,
          fingerprint: person.idHmac ? sourceIdentityDigestToFingerprint(person.idHmac) : null,
        })),
      },
      { get: false }
    ),
    accepted.refine((v) => v.caseId === receipt.case_id)
  );
}

async function requireReviewedBusiness(api: FoundationAuthenticatedApi, id: string) {
  const business = z.uuid().parse(id);
  const current = await readMyBusinessChecks(api, business);
  if (!current.stickers.idReviewed)
    throw new FoundationStaffCommandError(
      403,
      "Complete your ID review before sending a CIPC document."
    );
  return business;
}

export function previewNativeCipc(request: Request, id: string) {
  return protectBusinessEvidenceRoute(
    request,
    "business-verification:preview",
    true,
    async (caller, incoming) => {
      const business = await requireReviewedBusiness(caller.api, id);
      const input = await cipcForm(incoming, ["file"]);
      if (input instanceof NextResponse) return input;
      const result = await settleStaffCommand(
        createFoundationServiceApi().rpc(
          "get_frontend_cipc_preview_context",
          {
            p_owner: caller.accountId,
            p_session: caller.sessionId,
            p_business: business,
            p_fingerprints: input.file.directorIdHmacs.map(sourceIdentityDigestToFingerprint),
          },
          { get: false }
        ),
        z.strictObject({
          profile_has_address: z.boolean(),
          director_index: z.number().int().nonnegative().nullable(),
        })
      );
      const hmac =
        result.director_index === null ? null : input.file.directorIdHmacs[result.director_index];
      if (hmac === undefined) throw new Error("CIPC preview proof changed");
      return NextResponse.json({
        preview: {
          ...ownerPreview(input.file, hmac),
          profileHasAddress: result.profile_has_address,
        },
      });
    }
  );
}

export function submitNativeCipc(request: Request, id: string) {
  return protectBusinessEvidenceRoute(
    request,
    "business-verification:cipc",
    true,
    async (caller, incoming) => {
      const business = await requireReviewedBusiness(caller.api, id);
      const input = await cipcForm(incoming, [
        "file",
        "registrationNumber",
        "route",
        "useOfficeAsAddress",
      ]);
      if (input instanceof NextResponse) return input;
      const entered = String(input.form.get("registrationNumber") ?? "").trim();
      const number = entered
        ? normaliseRegistrationNumber(entered)
        : input.file.stored?.registrationNumber;
      if (!number)
        return NextResponse.json(
          {
            error: "Enter the registration number as shown, for example 2020/123456/07.",
            code: entered ? "registration_number_invalid" : "registration_number_required",
          },
          { status: 400 }
        );
      const route = z
        .enum(["director", "representative"])
        .parse(input.form.get("route") ?? "director");
      const receipt = await settleStaffCommand(
        caller.api.rpc(
          "reserve_frontend_cipc_document",
          {
            p_business: business,
            p_number: number,
            p_route: route,
            p_office:
              input.form.get("useOfficeAsAddress") === "1" &&
              Boolean(input.file.office && officeToLocation(input.file.office)),
            p_digest: fileHash(input.file),
          },
          { get: false }
        ),
        reserved.refine((value) => value.owner_id === caller.accountId)
      );
      await recordCipcFile(caller, receipt, input.file);
      return NextResponse.json({ caseId: receipt.case_id, status: "pending" }, { status: 201 });
    }
  );
}

export function attachNativeOfficialCipc(request: Request, id: string) {
  return protectBusinessEvidenceRoute(
    request,
    "business-verification:admin-copy",
    true,
    async (caller, incoming) => {
      const caseId = z.uuid().parse(id);
      const claim = await currentBusinessClaim(caller.api, caller.accountId, caseId, true);
      if (!claim) throw new Error("Current claim required");
      const input = await cipcForm(incoming, ["file", "cipcReference", "expectedUpdatedAt"]);
      if (input instanceof NextResponse) return input;
      if (!input.file.stored || input.file.stored.docType === "unknown")
        return NextResponse.json(
          {
            error: "Attach the readable PDF you downloaded from CIPC.",
            code: "admin_copy_unreadable",
          },
          { status: 400 }
        );
      const expected = date.parse(input.form.get("expectedUpdatedAt"));
      const reference = z
        .string()
        .trim()
        .max(80)
        .parse(String(input.form.get("cipcReference") ?? ""));
      const receipt = await settleStaffCommand(
        caller.api.rpc(
          "reserve_frontend_cipc_official",
          {
            p_case: caseId,
            p_expected: expected,
            p_generation: claim.generation,
            p_nonce: claim.nonce,
            p_digest: fileHash(input.file),
          },
          { get: false }
        ),
        reserved.refine((value) => value.case_id === caseId && value.owner_id !== caller.accountId)
      );
      await recordCipcFile(caller, receipt, input.file, reference);
      return NextResponse.json({ ok: true }, { status: 201 });
    }
  );
}

export async function attachNativeCipcReplyFile(
  caller: { api: FoundationAuthenticatedApi; accountId: string; sessionId: string },
  business: string,
  current: {
    id: string;
    registrationNumber: string | null;
    route: "director" | "representative" | null;
  },
  upload: File
) {
  if (!current.registrationNumber || !current.route)
    throw new FoundationStaffCommandError(
      409,
      "Reload the CIPC case before attaching a new document."
    );
  const file = await readCipcFile(upload, { pdfOnly: true });
  if (isIntakeError(file)) throw new FoundationStaffCommandError(file.status, file.error);
  if (file.activeContent)
    throw new FoundationStaffCommandError(
      422,
      "This PDF contains active content. Download it again from CIPC."
    );
  const receipt = await settleStaffCommand(
    caller.api.rpc(
      "reserve_frontend_cipc_document",
      {
        p_business: business,
        p_case: current.id,
        p_number: current.registrationNumber,
        p_route: current.route,
        p_office: false,
        p_digest: fileHash(file),
      },
      { get: false }
    ),
    reserved.refine((value) => value.case_id === current.id && value.owner_id === caller.accountId)
  );
  await recordCipcFile(caller, receipt, file);
  return receipt.artifact_id;
}
