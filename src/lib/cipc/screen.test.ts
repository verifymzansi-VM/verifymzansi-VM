import { describe, expect, it } from "vitest";

import { parseRegisteredOffice } from "./address";
import { parseCipcText } from "./parse";
import type { PdfStructure } from "./pdf";
import {
  compareWithAdminCopy,
  comparableCompanyName,
  compareDirectorName,
  fingerprintTraits,
  looksOriginal,
  screenCipcSubmission,
  suggestNextStep,
  type ScreenInput,
} from "./screen";
import { cipcItems } from "./test-fixtures";

const GENUINE: PdfStructure = {
  producer: "Powered By Crystal",
  creator: "Crystal Reports",
  creationDate: null,
  modDate: null,
  revisionCount: 1,
  pageCount: 1,
  hasTextLayer: true,
  pdfVersion: "1.7",
  xrefStreams: 0,
  objectStreams: 0,
  hasXmp: false,
  hasAnnotations: false,
  hasAcroForm: false,
  fonts: ["Arial", "Arial,Bold", "Arial,BoldItalic"],
  imageCount: 3,
  overlappingText: 0,
};

function input(overrides: Partial<ScreenInput> = {}): ScreenInput {
  const parsed = parseCipcText(cipcItems());
  return {
    isPdf: true,
    activeContent: null,
    structure: GENUINE,
    parsed,
    enteredNumber: "2020/123456/07",
    ownerIdHmac: "hmac-owner",
    directorIdHmacs: ["hmac-owner"],
    directorsWithoutSaId: 0,
    sameFileOnOtherBusiness: false,
    verifiedForUnrelatedOwner: false,
    profileName: "Example Trading",
    office: parseRegisteredOffice(parsed.registeredOfficeLines),
    today: new Date("2026-10-06T08:00:00Z"),
    ...overrides,
  };
}

const codes = (i: ScreenInput) => screenCipcSubmission(i).map((f) => `${f.severity}:${f.code}`);

describe("screenCipcSubmission", () => {
  it("does not treat copyable producer metadata as proof of an original document", () => {
    const findings = screenCipcSubmission(input({ structure: { ...GENUINE } }));
    const indicator = findings.find((finding) => finding.code === "original_file");
    expect(indicator?.title).toBe("No recognized edit indicators");
    expect(indicator?.detail).toContain(
      "Authenticity requires comparison with an independent CIPC record"
    );
    expect(indicator?.detail).not.toMatch(/made by CIPC|never saved|authentic document/i);
  });

  it("reports matching reference indicators without claiming authenticity", () => {
    expect(codes(input())).toEqual([
      "ok:document_type",
      "ok:original_file",
      "ok:enterprise_status",
      "ok:owner_is_director",
    ]);
  });

  it("flags a re-saved file and a non-CIPC producer, without deciding", () => {
    const findings = screenCipcSubmission(
      input({ structure: { ...GENUINE, producer: "Microsoft: Print To PDF", revisionCount: 2 } })
    );
    const changed = findings.find((f) => f.code === "file_changed");
    expect(changed).toMatchObject({ severity: "attention", suggestedReason: "document_altered" });
    expect(changed?.detail).toContain("Microsoft: Print To PDF");
    expect(changed?.detail).toContain("2 PDF revision markers");
    expect(changed?.title).toBe("Possible editing indicators");
    expect(changed?.detail).toContain("do not establish when or why");
  });

  it("flags a photo for eye comparison", () => {
    expect(codes(input({ isPdf: false, structure: null, parsed: null }))).toContain(
      "attention:no_text_layer"
    );
  });

  it("quarantines active content", () => {
    const f = screenCipcSubmission(input({ activeContent: "pdf-active-content-openaction" }));
    expect(f[0]).toMatchObject({ code: "active_content", severity: "attention" });
  });

  it("flags a different number, a non-trading company and a non-director owner", () => {
    const parsed = parseCipcText(cipcItems({ status: "Deregistration Process" }));
    const c = codes(
      input({ parsed, enteredNumber: "2021/999999/07", directorIdHmacs: ["someone-else"] })
    );
    expect(c).toEqual(
      expect.arrayContaining([
        "attention:number_mismatch",
        "attention:enterprise_status",
        "attention:owner_not_listed",
      ])
    );
  });

  it("flags stale documents, conflicts, reuse, trading names and unknown cities", () => {
    const parsed = parseCipcText(
      cipcItems({
        issued: "Monday, January 6, 2025 at 09:00",
        office: ["X", "NOWHEREVILLE", "LIMPOPO", "0700"],
      })
    );
    const c = codes(
      input({
        parsed,
        office: parseRegisteredOffice(parsed.registeredOfficeLines),
        sameFileOnOtherBusiness: true,
        verifiedForUnrelatedOwner: true,
        profileName: "Thando's Kitchen",
        directorsWithoutSaId: 1,
      })
    );
    expect(c).toEqual(
      expect.arrayContaining([
        "check:issued_long_ago",
        "check:same_file_elsewhere",
        "attention:conflict_other_owner",
        "check:trading_name_differs",
        "check:city_not_listed",
        "check:director_without_sa_id",
      ])
    );
  });

  it("orders attention first", () => {
    const f = screenCipcSubmission(input({ directorIdHmacs: [] }));
    expect(f[0].severity).toBe("attention");
  });
});

describe("fingerprintTraits", () => {
  const strongOf = (s: Partial<PdfStructure>) =>
    fingerprintTraits({ ...GENUINE, ...s }, "registration_certificate").filter((t) => t.strong);

  it("finds nothing on an original CIPC download", () => {
    expect(fingerprintTraits(GENUINE, "registration_certificate")).toEqual([]);
    expect(looksOriginal(GENUINE, "registration_certificate")).toBe(true);
  });

  it.each<[string, Partial<PdfStructure>]>([
    ["an edit date", { modDate: "D:20261020101010+02'00'" }],
    ["a newer tool's rebuild", { xrefStreams: 1 }],
    ["editing-software metadata", { hasXmp: true }],
    ["comments or typed-on boxes", { hasAnnotations: true }],
    ["form fields", { hasAcroForm: true }],
    ["a foreign font", { fonts: ["Arial", "Calibri"] }],
    ["retyped text", { overlappingText: 2 }],
  ])("treats %s as a change", (_label, change) => {
    expect(strongOf(change)).toHaveLength(1);
    expect(looksOriginal({ ...GENUINE, ...change }, "registration_certificate")).toBe(false);
  });

  it("names at most three foreign fonts", () => {
    const [trait] = fingerprintTraits(
      { ...GENUINE, fonts: ["A1", "B2", "C3", "D4", "E5"] },
      "registration_certificate"
    );
    expect(trait.text).toBe("uses fonts outside the reference profile: A1, B2, C3 and 2 more");
  });

  it("keeps version and picture differences as weak signs", () => {
    const traits = fingerprintTraits(
      { ...GENUINE, pdfVersion: "1.4", imageCount: 4 },
      "registration_certificate"
    );
    expect(traits.map((t) => t.strong)).toEqual([false, false]);
    const parsed = parseCipcText(cipcItems({ kind: "registration_certificate" }));
    expect(codes(input({ parsed, structure: { ...GENUINE, pdfVersion: "1.4" } }))).toContain(
      "check:file_differs"
    );
  });

  it("doesn't hold disclosures to the certificate's fonts and pictures", () => {
    expect(
      fingerprintTraits({ ...GENUINE, fonts: ["Tahoma"], imageCount: 1 }, "free_disclosure")
    ).toEqual([{ strong: false, text: "uses fonts outside the reference profile: Tahoma" }]);
  });

  it("says nothing about a scanned file beyond no text layer", () => {
    expect(looksOriginal({ ...GENUINE, hasTextLayer: false }, null)).toBe(false);
    const c = codes(input({ structure: { ...GENUINE, hasTextLayer: false }, parsed: null }));
    expect(c.some((x) => /file_(changed|differs)|original_file/.test(x))).toBe(false);
  });
});

describe("compareDirectorName", () => {
  it.each<[string, string | null, string, ReturnType<typeof compareDirectorName>]>([
    ["DLAMINI, THANDO SIPHO", "Thando", "Dlamini", "match"],
    ["DU PLESSIS, RENÉ", "Rene", "du Plessis", "match"],
    ["MOKOENA, THANDO", "Thando", "Dlamini", "partial"],
    ["DLAMINI, SIPHO", "Thando", "Dlamini", "partial"],
    ["NAIDOO, PRIYA", "Thando", "Dlamini", "differs"],
    ["DLAMINI, THANDO", null, "", "differs"],
  ])("%s vs %s %s → %s", (director, first, last, expected) => {
    expect(compareDirectorName(director, { first, last })).toBe(expected);
  });
});

describe("identity findings", () => {
  const legal = { first: "Thando", last: "Dlamini" };

  it("says nothing when the ID and name both match", () => {
    const c = codes(
      input({
        ownerLegalName: legal,
        directors: [{ name: "DLAMINI, THANDO", idHmac: "hmac-owner" }],
      })
    );
    expect(c.some((x) => /id_matches|name_matches/.test(x))).toBe(false);
  });

  it("flags the same ID under a different name for a check", () => {
    const c = codes(
      input({ ownerLegalName: legal, directors: [{ name: "NAIDOO, PRIYA", idHmac: "hmac-owner" }] })
    );
    expect(c).toContain("check:id_matches_name_differs");
  });

  it("flags a director with the owner's name but another ID", () => {
    const f = screenCipcSubmission(
      input({
        ownerLegalName: legal,
        directorIdHmacs: ["someone-else"],
        directors: [{ name: "DLAMINI, THANDO", idHmac: "someone-else" }],
      })
    );
    expect(f.find((x) => x.code === "name_matches_id_differs")).toMatchObject({
      severity: "attention",
      suggestedReason: "owner_not_director",
    });
  });
});

describe("suggestNextStep", () => {
  it("never suggests approval without the admin's CIPC copy", () => {
    expect(suggestNextStep(screenCipcSubmission(input()), false).action).toBe("review");
    expect(suggestNextStep(screenCipcSubmission(input()), true).action).toBe("approve");
  });

  it("points non-directors to the representative route", () => {
    expect(suggestNextStep(screenCipcSubmission(input({ directorIdHmacs: [] })), true).action).toBe(
      "request_info"
    );
  });
});

describe("compareWithAdminCopy", () => {
  it("ignores company suffixes and reports real differences", () => {
    const owner = parseCipcText(cipcItems());
    const admin = parseCipcText(cipcItems({ name: "EXAMPLE TRADING", status: "In Liquidation" }));
    expect(compareWithAdminCopy(owner, admin, ["a"], ["a", "b"])).toEqual([
      { field: "Status", owner: "In Business", cipc: "In Liquidation" },
      { field: "Directors", owner: "1 listed", cipc: "2 listed" },
    ]);
  });

  it("normalises company names", () => {
    expect(comparableCompanyName("Example Trading (Pty) Ltd")).toBe(
      comparableCompanyName("EXAMPLE TRADING")
    );
  });
});
