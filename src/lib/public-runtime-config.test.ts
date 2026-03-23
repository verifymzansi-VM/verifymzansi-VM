import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PUBLIC_RUNTIME_CONFIG_ELEMENT_ID,
  getPublicRuntimeConfig,
  getServerPublicRuntimeConfig,
} from "@/lib/public-runtime-config";

describe("public runtime config", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllEnvs();
  });

  it("reads values from process env on the server", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "true");
    vi.stubEnv("NEXT_PUBLIC_VERIFYMZANSI_FACEBOOK_URL", "https://facebook.com/verifymzansi");
    vi.stubEnv("NEXT_PUBLIC_VERIFYMZANSI_X_URL", "https://x.com/verifymzansi");

    expect(getServerPublicRuntimeConfig()).toEqual({
      appUrl: "https://example.com",
      supabaseUrl: "https://demo.supabase.co",
      supabaseAnonKey: "anon-key",
      turnstileSiteKey: "site-key",
      cfImageResizing: true,
      officialSocialLinks: {
        facebook: "https://facebook.com/verifymzansi",
        youtube: undefined,
        x: "https://x.com/verifymzansi",
        tiktok: undefined,
        linkedin: undefined,
      },
    });
  });

  it("falls back to DOM data when the client bundle env is missing", () => {
    // Clear any env vars that CI may inject (e.g. NEXT_PUBLIC_SUPABASE_*)
    // so the merge logic genuinely falls through to DOM values.
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CF_IMAGE_RESIZING", "");
    vi.stubEnv("NEXT_PUBLIC_VERIFYMZANSI_FACEBOOK_URL", "");
    vi.stubEnv("NEXT_PUBLIC_VERIFYMZANSI_YOUTUBE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_VERIFYMZANSI_X_URL", "");
    vi.stubEnv("NEXT_PUBLIC_VERIFYMZANSI_TIKTOK_URL", "");
    vi.stubEnv("NEXT_PUBLIC_VERIFYMZANSI_LINKEDIN_URL", "");

    document.body.innerHTML = `
      <div
        id="${PUBLIC_RUNTIME_CONFIG_ELEMENT_ID}"
        data-app-url="https://runtime.example.com"
        data-supabase-url="https://runtime.supabase.co"
        data-supabase-anon-key="runtime-anon"
        data-turnstile-site-key="runtime-site-key"
        data-cf-image-resizing="false"
        data-social-facebook-url="https://facebook.com/runtime"
        data-social-linkedin-url="https://linkedin.com/company/runtime"
      ></div>
    `;

    expect(getPublicRuntimeConfig()).toEqual({
      appUrl: "https://runtime.example.com",
      supabaseUrl: "https://runtime.supabase.co",
      supabaseAnonKey: "runtime-anon",
      turnstileSiteKey: "runtime-site-key",
      cfImageResizing: false,
      officialSocialLinks: {
        facebook: "https://facebook.com/runtime",
        youtube: undefined,
        x: undefined,
        tiktok: undefined,
        linkedin: "https://linkedin.com/company/runtime",
      },
    });
  });

  it("prefers compiled env values when they are available", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://env.example.com");
    document.body.innerHTML = `
      <div id="${PUBLIC_RUNTIME_CONFIG_ELEMENT_ID}" data-app-url="https://runtime.example.com"></div>
    `;

    expect(getPublicRuntimeConfig().appUrl).toBe("https://env.example.com");
  });
});
