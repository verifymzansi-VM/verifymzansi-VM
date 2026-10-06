import { describe, expect, it } from "vitest";

import { parseRegisteredOffice } from "./address";
import { parseCipcText } from "./parse";
import type { PdfStructure } from "./pdf";
import {
  compareWithAdminCopy,
  comparableCompanyName,
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
  it("reports a genuine, matching document as all OK", () => {
    expect(codes(input())).toEqual([
      "ok:document_type",
      "ok:enterprise_status",
      "ok:owner_is_director",
    ]);
  });

  it("flags a re-saved file and a non-CIPC producer, without deciding", () => {
    const findings = screenCipcSubmission(
      input({ structure: { ...GENUINE, producer: "Microsoft: Print To PDF", revisionCount: 2 } })
    );
    expect(findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["producer_mismatch", "edited_after_issue"])
    );
    expect(findings.find((f) => f.code === "producer_mismatch")?.severity).toBe("check");
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
