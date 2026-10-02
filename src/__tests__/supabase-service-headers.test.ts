import { describe, expect, it } from "vitest";
import { supabaseServiceHeaders } from "../../workers/supabase-headers";

describe("supabaseServiceHeaders", () => {
  it("sends legacy JWT service_role keys as apikey and bearer token", () => {
    expect(supabaseServiceHeaders("eyJhbGciOiJIUzI1NiJ9.legacy")).toEqual({
      apikey: "eyJhbGciOiJIUzI1NiJ9.legacy",
      Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.legacy",
    });
  });

  it("never sends new sb_secret keys as a bearer token (the gateway rejects them)", () => {
    const headers = supabaseServiceHeaders("sb_secret_example", { Prefer: "return=minimal" });
    expect(headers).toEqual({ apikey: "sb_secret_example", Prefer: "return=minimal" });
    expect(headers).not.toHaveProperty("Authorization");
  });
});
