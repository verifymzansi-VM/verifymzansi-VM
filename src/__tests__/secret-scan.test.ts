import { describe, expect, it } from "vitest";
import { isAllowedLine, shouldIgnoreSecretFinding } from "@/lib/security/secret-scan";

describe("secret scan allowlisting", () => {
  const fakeHash = "f".repeat(64);

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

  it("allows skills lockfile computed hashes without ignoring other 64-char hex strings", () => {
    expect(
      shouldIgnoreSecretFinding({
        filePath: "skills-lock.json",
        line: `      "computedHash": "${fakeHash}"`,
        ruleName: "64-char hex string (potential encryption key)",
      })
    ).toBe(true);

    expect(
      shouldIgnoreSecretFinding({
        filePath: "notes.txt",
        line: fakeHash,
        ruleName: "64-char hex string (potential encryption key)",
      })
    ).toBe(false);
  });
});
