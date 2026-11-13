import { officeToLocation, registeredOfficeSummary } from "@/lib/cipc/address";
import { looksOriginal } from "@/lib/cipc/screen";

import type { CipcFile } from "./intake";

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
