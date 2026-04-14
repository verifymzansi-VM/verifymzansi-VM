import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE,
  TURNSTILE_UNAVAILABLE_MESSAGE,
  getTurnstileClientState,
} from "@/lib/turnstile-client";

describe("turnstile client state", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats the dummy site key as bypass mode", () => {
    expect(
      getTurnstileClientState({
        appUrl: "https://example.com",
        supabaseUrl: "",
        supabaseAnonKey: "",
        turnstileSiteKey: "dummy_site_key",
        cfImageResizing: false,
        officialSocialLinks: {},
      })
    ).toEqual({
      mode: "bypass",
      siteKey: "dummy_site_key",
    });
  });

  it("treats a real site key as configured mode", () => {
    expect(
      getTurnstileClientState({
        appUrl: "https://example.com",
        supabaseUrl: "",
        supabaseAnonKey: "",
        turnstileSiteKey: "0x4AAAA-real",
        cfImageResizing: false,
        officialSocialLinks: {},
      })
    ).toEqual({
      mode: "configured",
      siteKey: "0x4AAAA-real",
    });
  });

  it("fails closed in production when the public site key is missing", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(
      getTurnstileClientState({
        appUrl: "https://example.com",
        supabaseUrl: "",
        supabaseAnonKey: "",
        turnstileSiteKey: "",
        cfImageResizing: false,
        officialSocialLinks: {},
      })
    ).toEqual({
      mode: "unavailable",
      siteKey: "",
    });
    expect(TURNSTILE_UNAVAILABLE_MESSAGE).toContain("temporarily unavailable");
  });

  it("exposes a dedicated message for unauthorized Turnstile domains", () => {
    expect(TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE).toContain("domain is not authorized");
  });
});
