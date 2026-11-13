import { officeToLocation, registeredOfficeSummary } from "@/lib/cipc/address";
import { looksOriginal } from "@/lib/cipc/screen";

import type { CipcFile } from "./intake";
import type { RegisteredOfficeView } from "./public";

export const STICKER_TTL_DAYS = 365;
export const FILE_RETENTION_DAYS = 30;

type OfficeCase = {
  kind: string;
  registered_office: RegisteredOfficeView | null;
  admin_copy: { registeredOffice?: RegisteredOfficeView | null } | null;
  linked_case_id: string | null;
};

/** The full registered office a case rests on (staff-corrected, else CIPC's copy). */
export function caseOffice(row: Pick<OfficeCase, "registered_office" | "admin_copy">) {
  return row.registered_office ?? row.admin_copy?.registeredOffice ?? null;
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
    looksOriginal: looksOriginal(file.structure, stored?.docType ?? null),
    /** The registered office can fill the profile's location fields. */
    officeUsable: Boolean(file.office && officeToLocation(file.office)),
  };
}
