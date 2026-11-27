import { describe, expect, it } from "vitest";
import { contactCallPhone, contactPhone, landlineDisplay, whatsappLink } from "./contact-links";

describe("contact links", () => {
  it("normalizes a local mobile for actual calls and WhatsApp", () => {
    expect(contactPhone("082 123 4567")).toBe("+27821234567");
    const url = new URL(whatsappLink("082 123 4567", "Home & garden", "/listing/abc")!);
    expect(url.pathname).toBe("/27821234567");
    expect(url.searchParams.get("text")).toContain("Home & garden");
    expect(url.searchParams.get("text")).toContain("https://verifymzansi.com/listing/abc");
  });
  it("calls a landline or a mobile, but WhatsApp stays mobile only", () => {
    expect(contactCallPhone("031 123 4567")).toBe("+27311234567");
    expect(contactCallPhone("+27311234567")).toBe("+27311234567");
    expect(contactCallPhone("(011) 123-4567")).toBe("+27111234567");
    expect(contactCallPhone("082 123 4567")).toBe("+27821234567");
    expect(whatsappLink("+27311234567", "Post", "/listing/abc")).toBeNull();
    // WhatsApp only for 06x, 071-074, 076-079 and 081-084.
    for (const value of ["0601234567", "0711234567", "0761234567", "0791234567", "0841234567"])
      expect(whatsappLink(value, "Post", "/listing/abc")).not.toBeNull();
    for (const value of ["0801234567", "0861234567", "0701234567", "0751234567", "0851234567"])
      expect(whatsappLink(value, "Post", "/listing/abc")).toBeNull();
    for (const value of [
      null,
      "",
      "0911234567",
      "0801234567",
      "0861234567",
      "082 *** 4567",
      "javascript:alert(1)",
    ])
      expect(contactCallPhone(value)).toBeNull();
  });
  it("does not build broken links from missing or masked details", () => {
    for (const value of [null, "", "082 *** 4567", "javascript:alert(1)"]) {
      expect(contactPhone(value)).toBeNull();
      expect(whatsappLink(value, "Post", "/listing/abc")).toBeNull();
    }
  });
  it("writes a landline the local way and leaves mobiles alone", () => {
    expect(landlineDisplay("+27311234567")).toBe("031 123 4567");
    expect(landlineDisplay("011 123 4567")).toBe("011 123 4567");
    expect(landlineDisplay("+27821234567")).toBeNull();
    expect(landlineDisplay(null)).toBeNull();
  });
});
