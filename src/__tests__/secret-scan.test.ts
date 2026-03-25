import { describe, expect, it } from "vitest";
import {
  isAllowedLine,
  SECRET_SCAN_RULES,
  shouldIgnoreSecretFinding,
} from "@/lib/security/secret-scan";

function getRule(name: string) {
  const rule = SECRET_SCAN_RULES.find((candidate) => candidate.name === name);
  expect(rule, `Expected secret scan rule \"${name}\" to exist`).toBeDefined();
  return rule!;
}

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

  it("detects unquoted env-style secret assignments for supported credentials", () => {
    expect(
      getRule("Hardcoded service role key assignment").pattern.test(
        "SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature"
      )
    ).toBe(true);
    expect(
      getRule("Turnstile secret key").pattern.test("TURNSTILE_SECRET_KEY=0x4AAAAAACexampleSecret")
    ).toBe(true);
    expect(
      getRule("Supabase access token").pattern.test(
        "SUPABASE_ACCESS_TOKEN=sbp_1234567890abcdefghijklmnop"
      )
    ).toBe(true);
    expect(
      getRule("Africa's Talking API key").pattern.test(
        "AFRICASTALKING_API_KEY=atsk_1234567890abcdefghijklmnop"
      )
    ).toBe(true);
    expect(
      getRule("Worker API key").pattern.test(
        "WORKER_API_KEY=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/="
      )
    ).toBe(true);
  });

  it("does not flag obvious placeholder worker secrets", () => {
    expect(
      getRule("Worker API key").pattern.test("WORKER_API_KEY=replace_with_worker_secret")
    ).toBe(false);
    expect(getRule("Worker API key").pattern.test("WORKER_API_KEY=placeholder-worker-secret")).toBe(
      false
    );
  });
});
