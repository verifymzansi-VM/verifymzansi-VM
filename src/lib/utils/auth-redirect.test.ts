import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthCallbackUrl, resolveAppOrigin } from "./auth-redirect";

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

// resolveAppOrigin also decides which origin mutation requests must come from
// (src/lib/utils/mutation-origin.ts) and where auth links point.
describe("resolveAppOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const from = (url: string) => resolveAppOrigin({ url });

  it("returns only the origin of the configured app URL, trimmed", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "  https://verifymzansi.com/some/path?x=1  ");
    expect(from("https://verifymzansi.com/api/x")).toBe("https://verifymzansi.com");
  });

  it("keeps the configured origin even when the request names another public host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
    expect(from("https://evil.example/api/x")).toBe("https://verifymzansi.com");
  });

  it("uses the request origin, with its port, when no app URL is set or it is blank", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "   ");
    expect(from("http://localhost:3000/api/x?y=1")).toBe("http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(from("https://verifymzansi.com:8443/a")).toBe("https://verifymzansi.com:8443");
  });

  it("in production replaces a loopback app URL only when the request is public", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const loopback of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", loopback);
      expect(from("https://verifymzansi.com/api/x")).toBe("https://verifymzansi.com");
      expect(from("http://localhost:4000/api/x")).toBe(loopback);
      expect(from("http://127.0.0.1:4000/api/x")).toBe(loopback);
    }
  });

  it("outside production keeps a loopback app URL whatever the request", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    expect(from("https://verifymzansi.com/api/x")).toBe("http://127.0.0.1:3000");
  });

  it("throws on a configured app URL that is not a URL instead of guessing", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "verifymzansi.com");
    expect(() => from("https://verifymzansi.com/api/x")).toThrow();
  });
});
