import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthCallbackUrl, resolveAppOrigin } from "@/lib/utils/auth-redirect";

describe("auth redirect helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers the public request origin over a stale localhost app url in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    const origin = resolveAppOrigin({ url: "https://verifymzansi.com/login" });

    expect(origin).toBe("https://verifymzansi.com");
  });

  it("builds callback urls from the configured public origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");

    const callbackUrl = buildAuthCallbackUrl(
      { url: "http://localhost:3000/register" },
      "/?confirmed=true"
    );

    const parsed = new URL(callbackUrl);
    expect(parsed.origin).toBe("https://verifymzansi.com");
    expect(parsed.pathname).toBe("/auth/callback");
    expect(parsed.searchParams.get("next")).toBe("/?confirmed=true");
  });
});
