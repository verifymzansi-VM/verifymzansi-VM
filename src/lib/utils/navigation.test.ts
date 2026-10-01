import { describe, expect, it } from "vitest";
import { sanitizeReturnUrl, buildLoginUrl } from "./navigation";

describe("sanitizeReturnUrl", () => {
  it("allows valid relative paths", () => {
    expect(sanitizeReturnUrl("/dashboard")).toBe("/dashboard");
    expect(sanitizeReturnUrl("/billing/checkout")).toBe("/billing/checkout");
  });

  it("allows known route prefixes", () => {
    expect(sanitizeReturnUrl("/verification")).toBe("/verification");
    expect(sanitizeReturnUrl("/post/create")).toBe("/post/create");
    expect(sanitizeReturnUrl("/admin/users")).toBe("/admin/users");
    expect(sanitizeReturnUrl("/reset-password")).toBe("/reset-password");
    expect(sanitizeReturnUrl("/mzansi-market")).toBe("/mzansi-market");
    expect(sanitizeReturnUrl("/dashboard?tab=listings")).toBe("/dashboard?tab=listings");
  });

  it("keeps the destination of every protected page the login redirect can send", () => {
    // The middleware sends signed-out visitors of these pages to /login with a
    // returnUrl; an unlisted prefix silently lands them on the home page.
    for (const path of [
      "/appeals/new?decision=abc",
      "/staff/two-step",
      "/dsar",
      "/billing",
      // A sponsor administrator signs in from an emailed invitation link.
      "/organisation-invite?token=abc_DEF-123",
      "/dashboard/affiliations?org=city-of-umhlathuze",
    ]) {
      expect(sanitizeReturnUrl(path)).toBe(path);
    }
  });

  it("blocks unknown route prefixes", () => {
    expect(sanitizeReturnUrl("/evil-page")).toBe("/");
    expect(sanitizeReturnUrl("/unknown/route")).toBe("/");
  });

  it("allows the home page", () => {
    expect(sanitizeReturnUrl("/")).toBe("/");
  });

  it("returns / for null/undefined", () => {
    expect(sanitizeReturnUrl(null)).toBe("/");
    expect(sanitizeReturnUrl(undefined)).toBe("/");
  });

  it("blocks protocol-relative URLs (//)", () => {
    expect(sanitizeReturnUrl("//evil.com")).toBe("/");
  });

  it("blocks URLs with protocols", () => {
    expect(sanitizeReturnUrl("http://evil.com")).toBe("/");
    expect(sanitizeReturnUrl("https://evil.com")).toBe("/");
  });

  it("blocks javascript: URIs", () => {
    expect(sanitizeReturnUrl("javascript:alert(1)")).toBe("/");
  });

  it("blocks data: URIs", () => {
    expect(sanitizeReturnUrl("data:text/html,<h1>hi</h1>")).toBe("/");
  });

  it("blocks paths not starting with /", () => {
    expect(sanitizeReturnUrl("evil.com/path")).toBe("/");
  });
});

describe("buildLoginUrl", () => {
  it("returns /login with no returnUrl", () => {
    expect(buildLoginUrl()).toBe("/login");
  });

  it("appends returnUrl parameter", () => {
    expect(buildLoginUrl("/dashboard")).toBe("/login?returnUrl=%2Fdashboard");
  });

  it("sanitizes dangerous returnUrls", () => {
    const result = buildLoginUrl("//evil.com");
    expect(result).toContain("returnUrl=%2F");
  });
});
