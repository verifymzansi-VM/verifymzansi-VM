import type { SupabaseClient } from "@supabase/supabase-js";

import { registeredOfficeSummary } from "@/lib/cipc/address";
import { normaliseRegistrationNumber } from "@/lib/cipc/parse";
import { screenCipcSubmission, type Finding } from "@/lib/cipc/screen";
import { deleteFromR2, uploadKycDocument } from "@/lib/services/storage";
import { createLogger } from "@/lib/utils/logger";

import type { CipcFile } from "./intake";

const log = createLogger("BusinessVerification");

type Admin = SupabaseClient;

export const STICKER_TTL_DAYS = 365;
export const FILE_RETENTION_DAYS = 30;

export type OwnedBusiness = {
  id: string;
  owner_id: string;
  business_name: string;
  cipc_verified_at: string | null;
  cipc_registration_number: string | null;
};

export async function loadOwnedBusiness(
  admin: Admin,
  userId: string,
  businessId: string
): Promise<OwnedBusiness | null> {
  const { data, error } = await admin
    .from("businesses")
    .select("id, owner_id, business_name, cipc_verified_at, cipc_registration_number")
    .eq("id", businessId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.owner_id !== userId) return null;
  return data as OwnedBusiness;
}

/** Sticker 1: the account passed ID + selfie review. */
export async function isIdReviewed(admin: Admin, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("account_profiles")
    .select("account_verification_status, account_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (
    data?.account_verification_status === "verified" &&
    ["active", "warned"].includes(String(data?.account_status ?? "active"))
  );
}

/** HMAC of the owner's approved SA ID number (null if none on file). */
export async function ownerIdHmac(admin: Admin, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("verification_steps")
    .select("id_number_hmac")
    .eq("user_id", userId)
    .eq("step_type", "id_doc")
    .eq("status", "approved")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.id_number_hmac as string | null) ?? null;
}

/** Another owner already holds the CIPC sticker for this company number. */
async function verifiedForUnrelatedOwner(
  admin: Admin,
  userId: string,
  registrationNumber: string | null
): Promise<boolean> {
  if (!registrationNumber) return false;
  const { data, error } = await admin
    .from("businesses")
    .select("id")
    .eq("cipc_registration_number", registrationNumber)
    .not("cipc_verified_at", "is", null)
    .neq("owner_id", userId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

async function sameFileOnOtherBusiness(admin: Admin, sha256: string, businessId: string) {
  const { data, error } = await admin
    .from("business_verification_files")
    .select("case_id, business_verifications!inner(business_id)")
    .eq("sha256", sha256)
    .neq("business_verifications.business_id", businessId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

export async function screenUpload(
  admin: Admin,
  input: {
    file: CipcFile;
    userId: string;
    businessId: string;
    businessName: string;
    enteredNumber: string | null;
    today?: Date;
  }
): Promise<{ findings: Finding[]; registrationNumber: string | null; ownerHmac: string | null }> {
  const { file } = input;
  const registrationNumber =
    file.parsed?.registrationNumber ?? normaliseRegistrationNumber(input.enteredNumber ?? "");
  const [ownerHmac, conflict, reused] = await Promise.all([
    ownerIdHmac(admin, input.userId),
    verifiedForUnrelatedOwner(admin, input.userId, registrationNumber),
    sameFileOnOtherBusiness(admin, file.sha256, input.businessId),
  ]);
  const findings = screenCipcSubmission({
    isPdf: file.isPdf,
    activeContent: file.activeContent,
    structure: file.structure,
    parsed: file.parsed,
    enteredNumber: input.enteredNumber ? normaliseRegistrationNumber(input.enteredNumber) : null,
    ownerIdHmac: ownerHmac,
    directorIdHmacs: file.directorIdHmacs,
    directorsWithoutSaId: file.directorsWithoutSaId,
    sameFileOnOtherBusiness: reused,
    verifiedForUnrelatedOwner: conflict,
    profileName: input.businessName,
    office: file.office,
    today: input.today ?? new Date(),
  });
  return { findings, registrationNumber, ownerHmac };
}

/** What the owner sees after we read their document (names only, no IDs). */
export function ownerPreview(file: CipcFile, ownerHmac: string | null) {
  const stored = file.stored;
  const matched = stored?.directors.find((d) => d.idHmac && d.idHmac === ownerHmac) ?? null;
  return {
    readable: Boolean(stored && stored.docType !== "unknown"),
    docType: stored?.docType ?? null,
    registrationNumber: stored?.registrationNumber ?? null,
    registeredName: stored?.registeredName ?? null,
    status: stored?.enterpriseStatus ?? null,
    directors: stored?.directors.map((d) => ({ name: d.name, role: d.role })) ?? [],
    registeredOffice: file.office ? registeredOfficeSummary(file.office) : null,
    ownerListedAs: matched?.role ?? null,
  };
}

/**
 * Stores an encrypted file for a case. The caller inserts the row; on any
 * later failure it must call `discardStoredFile`.
 */
export async function storeCaseFile(file: CipcFile, ownerId: string, kind: string) {
  const blob = new Blob([file.bytes as BlobPart], { type: file.contentType });
  const upload = await uploadKycDocument(blob, ownerId, `business-${kind}`);
  return upload.key;
}

export async function discardStoredFile(key: string) {
  try {
    await deleteFromR2(process.env.R2_PRIVATE_BUCKET || "verifymzansi-private", key);
  } catch (error) {
    log.error("Failed to delete orphaned verification file", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function fileRow(
  file: CipcFile,
  input: { caseId: string; kind: string; uploadedBy: string; r2Key: string }
) {
  return {
    case_id: input.caseId,
    kind: input.kind,
    uploaded_by: input.uploadedBy,
    r2_key: input.r2Key,
    content_type: file.contentType,
    size_bytes: file.sizeBytes,
    sha256: file.sha256,
    producer: file.structure?.producer ?? null,
    revision_count: file.structure?.revisionCount ?? null,
    quarantined: file.activeContent !== null,
    extracted_text: file.extractedText,
  };
}
