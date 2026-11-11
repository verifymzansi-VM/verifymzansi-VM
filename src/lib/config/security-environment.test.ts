import { afterEach, describe, expect, it, vi } from "vitest";
import { isProductionDataEnvironment } from "./security-environment";
describe("live-data security environment", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["gntzjtuncsyefujajmjy", "tnygdgormnofpgjknlhr"])(
    "preserves production checks when development settings reference hosted data: %s",
    (project) => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ENVIRONMENT", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${project}.supabase.co`);
      expect(isProductionDataEnvironment()).toBe(true);
    }
  );
  it("preserves explicit production markers", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENVIRONMENT", "production");
    expect(isProductionDataEnvironment()).toBe(true);
  });
  it("treats a distinct local development target as non-production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENVIRONMENT", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:56421");
    expect(isProductionDataEnvironment()).toBe(false);
  });
});
