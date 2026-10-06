import { describe, expect, it } from "vitest";

import { parseRegisteredOffice, registeredOfficeSummary } from "./address";
import { normaliseRegistrationNumber, parseCipcText } from "./parse";
import { cipcItems, FAKE_DIRECTOR_ID, FAKE_SECOND_ID } from "./test-fixtures";

describe("normaliseRegistrationNumber", () => {
  it.each([
    ["2020 / 123456 / 07", "2020/123456/07"],
    ["2020/123456/07", "2020/123456/07"],
    ["2020-123456-07", "2020/123456/07"],
    [" 1999/000001/23 ", "1999/000001/23"],
  ])("normalises %s", (input, expected) => {
    expect(normaliseRegistrationNumber(input)).toBe(expected);
  });

  it.each(["2020/12345/07", "abcd/123456/07", "2020/123456/7", ""])("rejects %s", (input) => {
    expect(normaliseRegistrationNumber(input)).toBeNull();
  });
});

describe("parseCipcText", () => {
  it("reads an official disclosure", () => {
    const parsed = parseCipcText(cipcItems());
    expect(parsed).toEqual({
      docType: "official_disclosure",
      issuedOn: "2026-10-05",
      registrationNumber: "2020/123456/07",
      registeredName: "EXAMPLE TRADING (PTY) LTD",
      enterpriseType: "Private Company",
      enterpriseStatus: "In Business",
      registrationDate: "2020-03-14",
      registeredOfficeLines: [
        "12 MAIN ROAD",
        "KWADLANGEZWA",
        "EMPANGENI",
        "KWA-ZULU NATAL",
        "3886",
      ],
      directors: [
        {
          name: "DLAMINI, THANDO",
          role: "Director",
          idNumber: FAKE_DIRECTOR_ID,
          dateOfBirth: null,
          appointedOn: "2020-03-14",
        },
      ],
    });
  });

  it("recognises a CoR14.3 registration certificate", () => {
    expect(parseCipcText(cipcItems({ kind: "registration_certificate" })).docType).toBe(
      "registration_certificate"
    );
  });

  it("treats a disclosure without the change history as the free disclosure", () => {
    expect(parseCipcText(cipcItems({ kind: "free_disclosure" })).docType).toBe("free_disclosure");
  });

  it("flags documents that are not CIPC documents", () => {
    expect(parseCipcText(cipcItems({ kind: "other" })).docType).toBe("unknown");
  });

  it("reads close corporation members and directors without an SA ID", () => {
    const parsed = parseCipcText(
      cipcItems({
        directors: [
          { name: "NKOSI, AYANDA", role: "Member", id: FAKE_SECOND_ID },
          { name: "SMITH, JOHN PAUL", role: "Director", id: "02/11/1975" },
        ],
      })
    );
    expect(parsed.directors).toEqual([
      expect.objectContaining({ name: "NKOSI, AYANDA", role: "Member", idNumber: FAKE_SECOND_ID }),
      expect.objectContaining({
        name: "SMITH, JOHN PAUL",
        idNumber: null,
        dateOfBirth: "1975-11-02",
      }),
    ]);
  });

  it("returns empty fields for an unrelated page", () => {
    const parsed = parseCipcText([{ x: 30, y: 700, text: "Hello" }]);
    expect(parsed.registrationNumber).toBeNull();
    expect(parsed.directors).toEqual([]);
    expect(parsed.registeredOfficeLines).toEqual([]);
  });
});

describe("parseRegisteredOffice", () => {
  it("splits the CIPC address bottom-up and recognises the town", () => {
    const office = parseRegisteredOffice([
      "12 MAIN ROAD",
      "KWADLANGEZWA",
      "EMPANGENI",
      "KWA-ZULU NATAL",
      "3886",
    ]);
    expect(office).toEqual({
      streetLines: ["12 Main Road"],
      suburb: "KwaDlangezwa",
      city: "Empangeni",
      province: "KwaZulu-Natal",
      postalCode: "3886",
      cityKnown: true,
    });
    expect(registeredOfficeSummary(office)).toBe("KwaDlangezwa, Empangeni, KwaZulu-Natal");
  });

  it("keeps an unknown city as printed", () => {
    const office = parseRegisteredOffice(["5 SHOP STREET", "NOWHEREVILLE", "LIMPOPO", "0700"]);
    expect(office.city).toBe("Nowhereville");
    expect(office.cityKnown).toBe(false);
    expect(office.province).toBe("Limpopo");
  });
});
