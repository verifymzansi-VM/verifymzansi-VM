import { describe, expect, it } from "vitest";
import { createPlaywrightStubSupabaseClient } from "@/lib/supabase/playwright-stub";

describe("createPlaywrightStubSupabaseClient", () => {
  it("returns a same-origin OAuth URL in stub mode", async () => {
    const client = createPlaywrightStubSupabaseClient();

    const result = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fdashboard",
      },
    });

    expect(result.error).toBeNull();
    expect(result.data.url).toBe("http://localhost:3000/login#oauth-ok");
  });
});
