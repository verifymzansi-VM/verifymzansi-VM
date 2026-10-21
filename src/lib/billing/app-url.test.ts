import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSafeBillingAppUrl } from "./app-url";
import { createLogger } from "@/lib/utils/logger";

vi.mock("@/lib/config/env", () => ({
  env: () => process.env.NEXT_PUBLIC_APP_URL,
}));

describe("billing application origin", () => {
  const log = createLogger("BillingOriginTest");
  beforeEach(() => vi.stubEnv("NODE_ENV", "production"));
  afterEach(() => vi.unstubAllEnvs());

  it.each(["https://verifymzansi.com", "https://staging.verifymzansi.com"])(
    "allows the configured application origin %s",
    (value) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", `${value}/`);
      expect(resolveSafeBillingAppUrl(log)).toEqual({ appUrl: value, response: null });
    }
  );

  it.each([
    "https://fakeverifymzansi.com",
    "https://verifymzansi.com.example.org",
    "https://verifymzansi.com@other.example",
    "https://operator:credential@verifymzansi.com",
    "http://verifymzansi.com",
    "https://verifymzansi.com:8443",
    "http://localhost:3000",
    "https://verifymzansi.com/billing",
    "https://verifymzansi.com?next=other",
    "https://verifymzansi.com#next",
    "javascript:alert(1)",
    "invalid",
  ])("fails closed for an invalid billing origin %s", (value) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const result = resolveSafeBillingAppUrl(log);
    expect(result.appUrl).toBeNull();
    expect(result.response?.status).toBe(503);
    expect(JSON.stringify(error.mock.calls)).not.toContain(value);
    error.mockRestore();
  });

  it("permits local HTTP for development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000/");
    expect(resolveSafeBillingAppUrl(log)).toEqual({
      appUrl: "http://localhost:3000",
      response: null,
    });
  });
});
