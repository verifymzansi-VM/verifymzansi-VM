import { describe, expect, it } from "vitest";
import { resolveDbTestTarget } from "../../scripts/db-test-target";

const fixture = {
  DB_TEST_SUPABASE_URL: "http://127.0.0.1:54321",
  DB_TEST_SUPABASE_ANON_KEY: "fixture-anon",
  DB_TEST_SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
};

describe("database test target isolation", () => {
  it("does not fall back to application credentials", () => {
    expect(() =>
      resolveDbTestTarget({
        NEXT_PUBLIC_SUPABASE_URL: "https://app.example.com",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "app-anon",
        SUPABASE_SERVICE_ROLE_KEY: "app-service",
      })
    ).toThrow("dedicated");
  });
  it("allows an explicitly configured local fixture database", () => {
    expect(resolveDbTestTarget(fixture).url).toBe(fixture.DB_TEST_SUPABASE_URL);
  });
  it("rejects remote targets by default", () => {
    expect(() =>
      resolveDbTestTarget({ ...fixture, DB_TEST_SUPABASE_URL: "https://staging.example.com" })
    ).toThrow("DB_TEST_ALLOW_REMOTE");
  });
  it("rejects the application database even with remote opt-in", () => {
    expect(() =>
      resolveDbTestTarget({
        ...fixture,
        DB_TEST_SUPABASE_URL: "https://app.example.com/",
        NEXT_PUBLIC_SUPABASE_URL: "https://app.example.com",
        DB_TEST_ALLOW_REMOTE: "true",
      })
    ).toThrow("application database");
  });
  it("allows a dedicated remote test target only with explicit opt-in", () => {
    expect(
      resolveDbTestTarget({
        ...fixture,
        DB_TEST_SUPABASE_URL: "https://staging.example.com",
        NEXT_PUBLIC_SUPABASE_URL: "https://app.example.com",
        DB_TEST_ALLOW_REMOTE: "true",
      }).url
    ).toBe("https://staging.example.com");
  });
  it.each(["file:///tmp/db", "https://user:password@example.com"])(
    "rejects unsafe URL %s",
    (url) => {
      expect(() => resolveDbTestTarget({ ...fixture, DB_TEST_SUPABASE_URL: url })).toThrow(
        "http(s)"
      );
    }
  );
});
