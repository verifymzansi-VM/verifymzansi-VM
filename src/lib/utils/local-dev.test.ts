import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

describe("isStrictLocalDevelopmentRequest", () => {
  function makeReq(hostname: string, origin?: string | null) {
    return {
      nextUrl: { hostname } as NextRequest["nextUrl"],
      headers: new Headers(origin != null ? { origin } : {}),
    } as Pick<NextRequest, "nextUrl" | "headers">;
  }

  it("returns true for localhost request with localhost origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { isStrictLocalDevelopmentRequest } = await import("./local-dev");
    expect(isStrictLocalDevelopmentRequest(makeReq("localhost", "http://localhost:3000"))).toBe(
      true
    );
    vi.unstubAllEnvs();
  });

  it("returns true for 127.0.0.1 request with 127.0.0.1 origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { isStrictLocalDevelopmentRequest } = await import("./local-dev");
    expect(isStrictLocalDevelopmentRequest(makeReq("127.0.0.1", "http://127.0.0.1:3000"))).toBe(
      true
    );
    vi.unstubAllEnvs();
  });

  it("returns false when NODE_ENV is not development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const mod = await import("./local-dev");
    expect(mod.isStrictLocalDevelopmentRequest(makeReq("localhost", "http://localhost"))).toBe(
      false
    );
    vi.unstubAllEnvs();
  });

  it("returns false for non-localhost hostname", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { isStrictLocalDevelopmentRequest } = await import("./local-dev");
    expect(isStrictLocalDevelopmentRequest(makeReq("example.com", "http://localhost"))).toBe(false);
    vi.unstubAllEnvs();
  });

  it("returns false when origin header is missing", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { isStrictLocalDevelopmentRequest } = await import("./local-dev");
    expect(isStrictLocalDevelopmentRequest(makeReq("localhost"))).toBe(false);
    vi.unstubAllEnvs();
  });

  it("returns false when origin is not a valid URL", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { isStrictLocalDevelopmentRequest } = await import("./local-dev");
    expect(isStrictLocalDevelopmentRequest(makeReq("localhost", "not-a-url"))).toBe(false);
    vi.unstubAllEnvs();
  });

  it("returns false when origin hostname is not localhost", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { isStrictLocalDevelopmentRequest } = await import("./local-dev");
    expect(isStrictLocalDevelopmentRequest(makeReq("localhost", "https://evil.com"))).toBe(false);
    vi.unstubAllEnvs();
  });
});
