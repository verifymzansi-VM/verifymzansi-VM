import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthCallbackUrl } from "./auth-redirect";

describe("buildAuthCallbackUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses NEXT_PUBLIC_APP_URL when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");

    const callbackUrl = buildAuthCallbackUrl(
      { url: "http://localhost:3000/api/auth/register" },
      "/login?confirmed=true"
    );

    expect(callbackUrl).toBe(
      "https://verifymzansi.com/auth/callback?next=%2Flogin%3Fconfirmed%3Dtrue"
    );
  });

  it("normalizes a trailing slash in NEXT_PUBLIC_APP_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com/");

    const callbackUrl = buildAuthCallbackUrl(
      { url: "http://localhost:3000/api/auth/register" },
      "/reset-password"
    );

    expect(callbackUrl).toBe("https://verifymzansi.com/auth/callback?next=%2Freset-password");
  });

  it("falls back to the request origin when the app URL is missing", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;

    const callbackUrl = buildAuthCallbackUrl(
      { url: "http://localhost:3000/api/auth/register" },
      "/login?confirmed=true"
    );

    expect(callbackUrl).toBe(
      "http://localhost:3000/auth/callback?next=%2Flogin%3Fconfirmed%3Dtrue"
    );
  });

  it("ignores a localhost app URL in production when the request is already public", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    const callbackUrl = buildAuthCallbackUrl(
      { url: "https://verifymzansi.com/api/auth/register" },
      "/login?confirmed=true"
    );

    expect(callbackUrl).toBe(
      "https://verifymzansi.com/auth/callback?next=%2Flogin%3Fconfirmed%3Dtrue"
    );
  });

  it("keeps localhost in development for same-machine testing", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    const callbackUrl = buildAuthCallbackUrl(
      { url: "https://verifymzansi.com/api/auth/register" },
      "/login?confirmed=true"
    );

    expect(callbackUrl).toBe(
      "http://localhost:3000/auth/callback?next=%2Flogin%3Fconfirmed%3Dtrue"
    );
  });
});
