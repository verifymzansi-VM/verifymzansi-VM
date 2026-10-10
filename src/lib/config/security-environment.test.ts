import { afterEach, describe, expect, it, vi } from "vitest";
import { isProductionDataEnvironment } from "./security-environment";
import { isStrictLocalDevelopmentRequest } from "@/lib/utils/local-dev";
const request = {
  nextUrl: new URL("http://localhost:3000"),
  headers: new Headers({ origin: "http://localhost:3000" }),
} as never;
describe("live-data security environment", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("preserves production checks for a development server using the live project", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENVIRONMENT", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://tnygdgormnofpgjknlhr.supabase.co");
    expect(isProductionDataEnvironment()).toBe(true);
    expect(isStrictLocalDevelopmentRequest(request)).toBe(false);
  });
  it("preserves explicit production markers", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENVIRONMENT", "production");
    expect(isProductionDataEnvironment()).toBe(true);
  });
  it("allows strict local fallback only for a distinct development target", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENVIRONMENT", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:56421");
    expect(isProductionDataEnvironment()).toBe(false);
    expect(isStrictLocalDevelopmentRequest(request)).toBe(true);
  });
});
