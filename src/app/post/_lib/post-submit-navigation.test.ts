import { describe, expect, it } from "vitest";
import { resolveServerRedirect } from "./post-submit-navigation";

describe("resolveServerRedirect", () => {
  it("keeps same-origin paths on known routes", () => {
    expect(resolveServerRedirect("/dashboard/complete-profile")).toBe(
      "/dashboard/complete-profile"
    );
    expect(resolveServerRedirect("/verification?step=phone")).toBe("/verification?step=phone");
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example",
    "javascript:alert(1)",
    "/unknown-route",
    "",
    "   ",
    undefined,
    null,
    42,
  ])("falls back to the dashboard listings page for %s", (value) => {
    expect(resolveServerRedirect(value)).toBe("/dashboard/listings");
  });

  it("honours a caller-provided fallback", () => {
    expect(resolveServerRedirect("https://evil.example", "/dashboard")).toBe("/dashboard");
  });
});
