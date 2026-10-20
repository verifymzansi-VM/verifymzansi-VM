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

/**
 * How a CoR14.3 looks straight out of CIPC (checked against a real one,
 * 2026-10-20): PDF 1.7, one classic xref, no dates or XMP, no annotations or
 * form fields, only Arial fonts, three pictures (logo, watermark, coat of
 * arms). Disclosures aren't calibrated yet, so their font and picture
 * differences stay weak signs.
 */
const CIPC_ORIGINAL = {
  pdfVersion: "1.7",
  fontFamily: /^Arial\b/,
  registrationCertificateImages: 3,
};

export type FingerprintTrait = {
  /** Strong traits mean the file was changed after CIPC issued it. */
  strong: boolean;
  text: string;
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Every way the file differs from an original CIPC download, in plain words. */
export function fingerprintTraits(
  structure: PdfStructure,
  docType: ParsedCipcDocument["docType"] | null
): FingerprintTrait[] {
  const calibrated = docType === "registration_certificate";
  const traits: FingerprintTrait[] = [];
  const add = (strong: boolean, text: string) => traits.push({ strong, text });

  if (structure.producer !== CIPC_PRODUCER || structure.creator !== CIPC_CREATOR) {
    const tool = [structure.creator, structure.producer].filter(Boolean).join(" / ") || "unknown";
    add(
      true,
      `creator/producer metadata names ${tool}, rather than the reference Crystal Reports values`
    );
  }
  if (structure.revisionCount > 1) {
    add(
      true,
      `contains ${plural(structure.revisionCount, "PDF revision marker", "PDF revision markers")}`
    );
  }
  if (structure.modDate) add(true, "reports a modification date absent from the reference profile");
  else if (structure.creationDate)
    add(false, "reports a creation date absent from the reference profile");
  if (structure.xrefStreams > 0 || structure.objectStreams > 0) {
    add(true, "contains cross-reference or object streams absent from the reference profile");
  }
  if (structure.hasXmp) add(true, "contains XMP metadata");
  if (structure.hasAnnotations) add(true, "has comments, stamps or typed-on text boxes");
  if (structure.hasAcroForm) add(true, "has fillable form fields");
  const foreignFonts = structure.fonts.filter((f) => !CIPC_ORIGINAL.fontFamily.test(f));
  if (foreignFonts.length) {
    const shown = foreignFonts.slice(0, 3).join(", ");
    const more = foreignFonts.length > 3 ? ` and ${foreignFonts.length - 3} more` : "";
    add(calibrated, `uses fonts outside the reference profile: ${shown}${more}`);
  }
  if (structure.overlappingText > 0) {
    add(
      true,
      `${plural(structure.overlappingText, "piece", "pieces")} of text printed on top of other text`
    );
  }
  if (calibrated && structure.pdfVersion && structure.pdfVersion !== CIPC_ORIGINAL.pdfVersion) {
    add(false, `PDF version ${structure.pdfVersion} (CIPC uses ${CIPC_ORIGINAL.pdfVersion})`);
  }
  if (calibrated && structure.imageCount !== CIPC_ORIGINAL.registrationCertificateImages) {
    add(
      false,
      `${plural(structure.imageCount, "picture", "pictures")} (CIPC certificates have ${CIPC_ORIGINAL.registrationCertificateImages})`
    );
  }
  return traits;
}

/** No strong recognized edit indicators; editable metadata cannot prove provenance. */
export function looksOriginal(
  structure: PdfStructure | null,
  docType: ParsedCipcDocument["docType"] | null
): boolean {
  return !!structure?.hasTextLayer && !fingerprintTraits(structure, docType).some((t) => t.strong);
}

function sentence(texts: string[]): string {
  const joined = texts.join("; ");
  return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
}

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
  /** Name on the owner's reviewed ID, when they have one. */
  ownerLegalName?: { first: string | null; last: string | null } | null;
  /** Directors as stored (name and ID hash), to compare names with the ID match. */
  directors?: Array<{ name: string; idHmac: string | null }>;
};

export type NameMatch = "match" | "partial" | "differs";

function nameTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * Compares a CIPC director ("DLAMINI, THANDO SIPHO") with the name on the
 * owner's reviewed ID. "match": same surname and first names that agree;
 * "partial": only the surname or only the first names agree (marriage, a
 * missing middle name, a typo); "differs": neither.
 */
export function compareDirectorName(
  directorName: string,
  legal: { first: string | null; last: string | null }
): NameMatch {
  const [surnamePart, ...rest] = directorName.split(",");
  const directorSurname = nameTokens(surnamePart).join("");
  const directorFirst = nameTokens(rest.join(" "));
  const ownerSurname = nameTokens(legal.last ?? "").join("");
  const ownerFirst = nameTokens(legal.first ?? "");
  if (!directorSurname || !ownerSurname) return "differs";
  const surnameSame = directorSurname === ownerSurname;
  const shared = ownerFirst.filter((t) => directorFirst.includes(t));
  const firstAgree =
    shared.length > 0 &&
    (shared.length === ownerFirst.length || shared.length === directorFirst.length);
  if (surnameSame && firstAgree) return "match";
  if (surnameSame || firstAgree) return "partial";
  return "differs";
}

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

  if (structure?.hasTextLayer && input.isPdf) {
    const traits = fingerprintTraits(structure, parsed?.docType ?? null);
    const strong = traits.filter((t) => t.strong).map((t) => t.text);
    const weak = traits.filter((t) => !t.strong).map((t) => t.text);
    if (strong.length) {
      add({
        code: "file_changed",
        severity: "attention",
        title: "Possible editing indicators",
        detail: `${sentence([...strong, ...weak])} These indicators do not establish when or why the file was saved. Compare every detail with an independent CIPC record.`,
        suggestedReason: "document_altered",
      });
    } else if (weak.length) {
      add({
        code: "file_differs",
        severity: "check",
        title: "Differs from the reference file profile",
        detail: `${sentence(weak)} These differences do not prove alteration. Compare it with an independent CIPC record.`,
      });
    } else {
      add({
        code: "original_file",
        severity: "ok",
        title: "No recognized edit indicators",
        detail:
          "File metadata and structure show no recognized edit indicators. Authenticity requires comparison with an independent CIPC record.",
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
    const legal = input.ownerLegalName;
    if (legal?.last) {
      const idMatch = input.directors?.find(
        (d) => input.ownerIdHmac && d.idHmac === input.ownerIdHmac
      );
      if (idMatch && compareDirectorName(idMatch.name, legal) === "differs") {
        add({
          code: "id_matches_name_differs",
          severity: "check",
          title: "Same ID number, different name",
          detail: `The director listed with the owner's ID is ${idMatch.name}; the reviewed ID says ${[legal.first, legal.last].filter(Boolean).join(" ")}. Often a marriage or a typo at CIPC.`,
        });
      }
      const nameOnly = idMatch
        ? undefined
        : input.directors?.find(
            (d) => d.idHmac !== null && compareDirectorName(d.name, legal) === "match"
          );
      if (nameOnly) {
        add({
          code: "name_matches_id_differs",
          severity: "attention",
          title: "Name matches a director, ID number doesn't",
          detail: `${nameOnly.name} has the owner's name but a different ID number. It may be someone else with the same name.`,
          suggestedReason: "owner_not_director",
        });
      }
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
