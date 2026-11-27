import { describe, expect, it } from "vitest";
import { contactCallPhone, contactPhone, whatsappLink } from "./contact-links";

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
    for (const value of [null, "", "0911234567", "082 *** 4567", "javascript:alert(1)"])
      expect(contactCallPhone(value)).toBeNull();
  });
  it("does not build broken links from missing or masked details", () => {
    for (const value of [null, "", "082 *** 4567", "javascript:alert(1)"]) {
      expect(contactPhone(value)).toBeNull();
      expect(whatsappLink(value, "Post", "/listing/abc")).toBeNull();
    }
  });
});
