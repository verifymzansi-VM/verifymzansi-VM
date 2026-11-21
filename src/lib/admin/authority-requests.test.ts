import { describe, expect, it } from "vitest";
import {
  AUTHORITY_REQUEST_MESSAGES,
  disclosureNumber,
  earlierRequestStatus,
  emailForLookup,
  formatDisclosurePhone,
  formatIdNumber,
  LOOKUP_KINDS,
  minutesLeft,
  phoneForLookup,
  postReferenceFromLink,
  requestTypeLabel,
} from "./authority-requests";

const POST_ID = "3f0c8a3e-6a43-4c0e-9d1e-2b8f6f1c9a10";

describe("authority request helpers", () => {
  it("finds the post in a pasted link, path, id or slug", () => {
    expect(postReferenceFromLink(`https://verifymzansi.co.za/listing/${POST_ID}`)).toBe(POST_ID);
    expect(postReferenceFromLink(`verifymzansi.co.za/mzansi-business/${POST_ID}/`)).toBe(POST_ID);
    expect(
      postReferenceFromLink(`https://www.verifymzansi.co.za/tourism-events/${POST_ID}?x=1#a`)
    ).toBe(POST_ID);
    expect(postReferenceFromLink(POST_ID.toUpperCase())).toBe(POST_ID);
    expect(postReferenceFromLink("  red-bicycle-for-sale  ")).toBe("red-bicycle-for-sale");
    expect(postReferenceFromLink("https://verifymzansi.co.za/listing/red-bicycle")).toBe(
      "red-bicycle"
    );
  });

  it("refuses anything that is not a post link, so a name never becomes a search", () => {
    for (const value of [
      "",
      "Thando Dlamini",
      "https://verifymzansi.co.za/profile/thando",
      "https://verifymzansi.co.za/listing/Thando Dlamini",
      "https://verifymzansi.co.za/listing/%E0%A4%A",
      `https://verifymzansi.co.za/listing/${POST_ID}/edit`,
      "x".repeat(3000),
    ])
      expect(postReferenceFromLink(value)).toBeNull();
  });

  it("turns South African phone numbers into +27 form and refuses others", () => {
    expect(phoneForLookup("082 123 4567")).toBe("+27821234567");
    expect(phoneForLookup("+27 82 123 4567")).toBe("+27821234567");
    expect(phoneForLookup("27821234567")).toBe("+27821234567");
    expect(phoneForLookup("Thando")).toBeNull();
    expect(phoneForLookup("+44 20 7946 0958")).toBeNull();
  });

  it("compares email addresses in lower case and refuses names", () => {
    expect(emailForLookup("  Thando@Example.co.za ")).toBe("thando@example.co.za");
    expect(emailForLookup("Thando Dlamini")).toBeNull();
    expect(emailForLookup(`${"a".repeat(250)}@b.co`)).toBeNull();
  });

  it("offers exactly four ways to search, none of them a name", () => {
    expect(LOOKUP_KINDS.map((kind) => kind.value)).toEqual(["post", "id_number", "phone", "email"]);
    expect(LOOKUP_KINDS.some((kind) => /name/i.test(kind.label))).toBe(false);
  });

  it("formats numbers, labels and the time left", () => {
    expect(disclosureNumber(42)).toBe("D-0042");
    expect(disclosureNumber(12345)).toBe("D-12345");
    expect(requestTypeLabel("subpoena")).toBe("Subpoena (Criminal Procedure Act, s205)");
    expect(requestTypeLabel("unknown")).toBe("Authority request");
    expect(formatIdNumber("8001015009087")).toBe("800101 5009 08 7");
    expect(formatDisclosurePhone("+27712345678")).toBe("+27 71 234 5678");
    expect(minutesLeft("2026-11-21T10:15:00Z", Date.parse("2026-11-21T10:03:10Z"))).toBe(12);
    expect(minutesLeft("2026-11-21T10:00:00Z", Date.parse("2026-11-21T10:03:10Z"))).toBe(0);
  });

  it("words the earlier requests' status like the design", () => {
    expect(earlierRequestStatus({ outcome: "record", printed: true, viewed: true }).label).toBe(
      "Printed"
    );
    expect(earlierRequestStatus({ outcome: "record", printed: false, viewed: true }).label).toBe(
      "Viewed only"
    );
    expect(earlierRequestStatus({ outcome: "no_match", printed: false, viewed: true }).label).toBe(
      "No match found"
    );
  });

  it("has a message for every refusal reason without personal data", () => {
    for (const message of Object.values(AUTHORITY_REQUEST_MESSAGES))
      expect(message).not.toMatch(/\{|\}|undefined/);
  });
});
