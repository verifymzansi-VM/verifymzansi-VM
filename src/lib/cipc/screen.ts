/**
 * Turns an uploaded CIPC document into findings for staff. Nothing here
 * accepts or rejects a submission: every check becomes a finding with a
 * plain-language meaning and, where relevant, a suggested reason code that
 * the reviewer may choose to use.
 */
import type { RegisteredOffice } from "./address";
import type { ParsedCipcDocument } from "./parse";
import type { PdfStructure } from "./pdf";

export const CIPC_REASON_CODES = [
  "not_in_business",
  "owner_not_director",
  "document_not_cipc",
  "document_altered",
  "details_mismatch",
  "conflict_other_owner",
  "unreadable",
] as const;
export type CipcReasonCode = (typeof CIPC_REASON_CODES)[number];

export type FindingSeverity = "attention" | "check" | "ok";

export type Finding = {
  code: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  suggestedReason?: CipcReasonCode;
};

const CIPC_PRODUCER = "Powered By Crystal";
const CIPC_CREATOR = "Crystal Reports";
const STALE_AFTER_DAYS = 90;

export type ScreenInput = {
  isPdf: boolean;
  /** Threat name from scanForMalware, when the file carries active content. */
  activeContent: string | null;
  structure: PdfStructure | null;
  parsed: ParsedCipcDocument | null;
  enteredNumber: string | null;
  ownerIdHmac: string | null;
  directorIdHmacs: string[];
  directorsWithoutSaId: number;
  sameFileOnOtherBusiness: boolean;
  verifiedForUnrelatedOwner: boolean;
  profileName: string | null;
  office: RegisteredOffice | null;
  today: Date;
};

/** "VERIFYMZANSI (PTY) LTD" and "Verifymzansi" compare equal. */
export function comparableCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\((PTY|RF)\)/g, " ")
    .replace(/\b(PTY|LTD|LIMITED|PROPRIETARY|CC|INC|NPC|SOC|RF)\b/g, " ")
    .replace(/[^A-Z0-9]/g, "");
}

const DOC_LABEL: Record<string, string> = {
  official_disclosure: "CIPC Disclosure Certificate",
  registration_certificate: "CIPC Registration Certificate (CoR14.3)",
  free_disclosure: "CIPC free disclosure",
};

function daysBetween(isoDate: string, today: Date): number {
  return Math.floor((today.getTime() - Date.parse(`${isoDate}T00:00:00Z`)) / 86_400_000);
}

export function screenCipcSubmission(input: ScreenInput): Finding[] {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const { parsed, structure } = input;

  if (input.activeContent) {
    add({
      code: "active_content",
      severity: "attention",
      title: "Contains scripts or auto-open actions",
      detail:
        "The file is quarantined and shown as text only. Do not download it. Rely on the copy you fetch from CIPC.",
      suggestedReason: "document_altered",
    });
  }

  if (!input.isPdf || !structure?.hasTextLayer) {
    add({
      code: "no_text_layer",
      severity: "attention",
      title: input.isPdf ? "Scanned PDF — no readable text" : "Photo of a document",
      detail:
        "We can't inspect the file itself. Compare it by eye with the copy you fetch from CIPC.",
    });
  }

  if (parsed) {
    if (parsed.docType === "unknown") {
      add({
        code: "not_recognised",
        severity: "attention",
        title: "Not recognised as a CIPC document",
        detail: "The title doesn't match a CIPC disclosure or registration certificate.",
        suggestedReason: "document_not_cipc",
      });
    } else {
      add({
        code: "document_type",
        severity: "ok",
        title: DOC_LABEL[parsed.docType],
        detail: "The layout matches the CIPC document we expect.",
      });
    }
  }

  if (structure && input.isPdf) {
    if (structure.producer !== CIPC_PRODUCER || structure.creator !== CIPC_CREATOR) {
      const tool = [structure.creator, structure.producer].filter(Boolean).join(" / ") || "unknown";
      add({
        code: "producer_mismatch",
        severity: "check",
        title: "Not saved by CIPC's software",
        detail: `CIPC files are made with Crystal Reports. This one was made or re-saved with: ${tool}.`,
        suggestedReason: "document_altered",
      });
    }
    const edited =
      structure.revisionCount > 1 ||
      (structure.creationDate && structure.modDate && structure.modDate > structure.creationDate);
    if (edited) {
      add({
        code: "edited_after_issue",
        severity: "check",
        title: "Edited after CIPC issued it",
        detail:
          "The file was saved again after it was created. Check every detail against your CIPC copy.",
        suggestedReason: "document_altered",
      });
    }
  }

  if (parsed?.issuedOn) {
    const age = daysBetween(parsed.issuedOn, input.today);
    if (age > STALE_AFTER_DAYS) {
      add({
        code: "issued_long_ago",
        severity: "check",
        title: `Issued ${age} days ago`,
        detail:
          "Directors or status may have changed since. Your CIPC copy shows the current record.",
      });
    }
  }

  if (
    input.enteredNumber &&
    parsed?.registrationNumber &&
    input.enteredNumber !== parsed.registrationNumber
  ) {
    add({
      code: "number_mismatch",
      severity: "attention",
      title: "Registration number differs",
      detail: `The owner entered ${input.enteredNumber}; the document shows ${parsed.registrationNumber}.`,
      suggestedReason: "details_mismatch",
    });
  }

  if (parsed?.enterpriseStatus) {
    const inBusiness = /^in business$/i.test(parsed.enterpriseStatus);
    add({
      code: "enterprise_status",
      severity: inBusiness ? "ok" : "attention",
      title: `Status: ${parsed.enterpriseStatus}`,
      detail: inBusiness
        ? "The company is trading according to this document."
        : "Only companies that are In Business can get the sticker.",
      suggestedReason: inBusiness ? undefined : "not_in_business",
    });
  }

  if (parsed) {
    if (input.ownerIdHmac && input.directorIdHmacs.includes(input.ownerIdHmac)) {
      add({
        code: "owner_is_director",
        severity: "ok",
        title: "Owner's ID matches a listed director",
        detail: "Confirm the same director appears on your CIPC copy.",
      });
    } else {
      add({
        code: "owner_not_listed",
        severity: "attention",
        title: "Owner not found among the directors",
        detail:
          "The owner's verified ID number isn't on this document. Use the company representative route, or request information.",
        suggestedReason: "owner_not_director",
      });
    }
    if (input.directorsWithoutSaId > 0) {
      add({
        code: "director_without_sa_id",
        severity: "check",
        title: "Director without an SA ID number",
        detail:
          "Shown with a date of birth only, so we can't match them by ID. Such companies use the representative route.",
      });
    }
  }

  if (input.sameFileOnOtherBusiness) {
    add({
      code: "same_file_elsewhere",
      severity: "check",
      title: "Same file used for another business",
      detail: "This exact file was submitted for a different business profile.",
    });
  }

  if (input.verifiedForUnrelatedOwner) {
    add({
      code: "conflict_other_owner",
      severity: "attention",
      title: "Already verified for another owner",
      detail:
        "Another account holds the CIPC sticker for this company. Treat this as a conflict case.",
      suggestedReason: "conflict_other_owner",
    });
  }

  if (parsed?.registeredName && input.profileName) {
    const same =
      comparableCompanyName(parsed.registeredName) === comparableCompanyName(input.profileName);
    if (!same) {
      add({
        code: "trading_name_differs",
        severity: "check",
        title: "Trading name differs from the registered name",
        detail: `Registered as ${parsed.registeredName}; the profile is called ${input.profileName}. Trading names are normal.`,
      });
    }
  }

  if (input.office?.city && !input.office.cityKnown) {
    add({
      code: "city_not_listed",
      severity: "check",
      title: `City "${input.office.city}" isn't in our list`,
      detail: "It is kept as printed. Correct the registered office before approving if needed.",
    });
  }

  if (input.isPdf && !parsed && !input.activeContent) {
    add({
      code: "unreadable",
      severity: "attention",
      title: "We couldn't open this PDF",
      detail: "It may be damaged or password-protected. Ask the owner for a fresh download.",
      suggestedReason: "unreadable",
    });
  }

  const order: Record<FindingSeverity, number> = { attention: 0, check: 1, ok: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

export type SuggestedStep = { action: "approve" | "request_info" | "review"; text: string };

/** A suggestion for the reviewer, clearly labelled as such in the UI. */
export function suggestNextStep(findings: Finding[], hasAdminCopy: boolean): SuggestedStep {
  const attention = findings.filter((f) => f.severity === "attention");
  if (attention.some((f) => f.code === "owner_not_listed")) {
    return {
      action: "request_info",
      text: "Owner isn't a listed director — ask about the representative route.",
    };
  }
  if (attention.length) {
    return {
      action: "review",
      text: `${attention.length} item(s) need attention before deciding.`,
    };
  }
  if (!hasAdminCopy) {
    return {
      action: "review",
      text: "Fetch the company from CIPC and attach your copy to compare.",
    };
  }
  return { action: "approve", text: "All checks match — approve if you agree." };
}

export type CopyDifference = { field: string; owner: string | null; cipc: string | null };

type ComparableDocument = Pick<
  ParsedCipcDocument,
  "registrationNumber" | "registeredName" | "enterpriseStatus" | "registeredOfficeLines"
>;

/** Field-by-field comparison of the owner's upload with the admin-fetched copy. */
export function compareWithAdminCopy(
  owner: ComparableDocument,
  admin: ComparableDocument,
  ownerDirectorHmacs: string[],
  adminDirectorHmacs: string[]
): CopyDifference[] {
  const diffs: CopyDifference[] = [];
  const check = (
    field: string,
    a: string | null,
    b: string | null,
    eq = (x: string, y: string) => x === y
  ) => {
    if (a && b ? !eq(a, b) : a !== b) diffs.push({ field, owner: a, cipc: b });
  };
  check("Registration number", owner.registrationNumber, admin.registrationNumber);
  check(
    "Registered name",
    owner.registeredName,
    admin.registeredName,
    (x, y) => comparableCompanyName(x) === comparableCompanyName(y)
  );
  check("Status", owner.enterpriseStatus, admin.enterpriseStatus);
  check(
    "Registered office",
    owner.registeredOfficeLines.join(", ") || null,
    admin.registeredOfficeLines.join(", ") || null
  );
  const ownerSet = [...ownerDirectorHmacs].sort().join(",");
  const adminSet = [...adminDirectorHmacs].sort().join(",");
  if (ownerSet !== adminSet) {
    diffs.push({
      field: "Directors",
      owner: `${ownerDirectorHmacs.length} listed`,
      cipc: `${adminDirectorHmacs.length} listed`,
    });
  }
  return diffs;
}
