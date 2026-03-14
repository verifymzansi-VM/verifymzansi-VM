import { describe, expect, it } from "vitest";
import { isAllowedLine, shouldIgnoreSecretFinding } from "@/lib/security/secret-scan";

describe("secret scan allowlisting", () => {
  it("allows explicit secret-scan comments", () => {
    expect(isAllowedLine('SUPABASE_SERVICE_ROLE_KEY: "fixture-secret" // secret-scan: allow')).toBe(
      true
    );
  });

  it("does not ignore real-looking secrets in non-fixture files", () => {
    expect(
      shouldIgnoreSecretFinding({
        filePath: "src/app/api/live/route.ts",
        line: 'TURNSTILE_SECRET_KEY: "test-secret-value"',
        ruleName: "Turnstile secret key",
      })
    ).toBe(false);
  });
});
