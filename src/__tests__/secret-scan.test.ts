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

  it("detects credential assignments in quoted JSON and bundled object keys", () => {
    const credentials = [
      [
        "Hardcoded service role key assignment",
        "SUPABASE_SERVICE_ROLE_KEY",
        "eyJ" + "a".repeat(32),
      ],
      ["Supabase access token", "SUPABASE_ACCESS_TOKEN", "sbp_" + "a".repeat(32)],
      ["Africa's Talking API key", "AFRICASTALKING_API_KEY", "atsk_" + "a".repeat(32)],
      ["Turnstile secret key", "TURNSTILE_SECRET_KEY", "0x" + "a".repeat(32)],
      ["Worker API key", "WORKER_API_KEY", "a".repeat(32)],
    ];
    for (const [name, key, value] of credentials) {
      const rule = getRule(name);
      for (const quote of ['"', "'"]) {
        const line = `{${quote}${key}${quote}:${quote}${value}${quote}}`;
        rule.pattern.lastIndex = 0;
        expect(rule.pattern.test(line), `${name} with ${quote} keys`).toBe(true);
        rule.pattern.lastIndex = 0;
        expect(
          shouldIgnoreSecretFinding({
            filePath: ".open-next/cloudflare/next-env.mjs",
            line,
            ruleName: name,
          })
        ).toBe(false);
      }
    }
  });

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
  it("fixture words and a neighbouring fixture value cannot exempt another credential", () => {
    for (const line of [
      "TURNSTILE_SECRET_KEY: " + JSON.stringify("unrelatedSensitiveValue") + " // test fixture",
      'const test = "dummy_fixture"; TURNSTILE_SECRET_KEY: ' +
        JSON.stringify("unrelatedSensitiveValue"),
    ]) {
      expect(
        shouldIgnoreSecretFinding({
          filePath: "src/fixture.test.ts",
          line,
          ruleName: "Turnstile secret key",
        })
      ).toBe(false);
    }
    expect(
      shouldIgnoreSecretFinding({
        filePath: "src/fixture.test.ts",
        line: 'TURNSTILE_SECRET_KEY: "dummy_secret_key"',
        ruleName: "Turnstile secret key",
      })
    ).toBe(true);
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

  it("allows generated build artifact hashes without suppressing named secret rules", () => {
    const keyLine = '"KYC_ENCRYPTION_KEY": ' + JSON.stringify(fakeHash);
    const encryptionRule = getRule("Hardcoded encryption or HMAC key assignment");
    expect(encryptionRule.pattern.test(keyLine)).toBe(true);
    encryptionRule.pattern.lastIndex = 0;
    expect(
      shouldIgnoreSecretFinding({
        filePath: ".next/server/chunks/7493.js",
        line: keyLine,
        ruleName: encryptionRule.name,
      })
    ).toBe(false);
    expect(
      shouldIgnoreSecretFinding({
        filePath: ".open-next/server-functions/default/.next/prerender-manifest.json",
        line: fakeHash,
        ruleName: "64-char hex string (potential encryption key)",
      })
    ).toBe(true);

    expect(
      shouldIgnoreSecretFinding({
        filePath: ".next/server/chunks/7493.js",
        line: "const key = getSecret();",
        ruleName: "Stripe live secret",
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
      getRule("Turnstile secret key").pattern.test(
        "TURNSTILE_SECRET_KEY=" + ["0x4AAAAAAC", "exampleSecret"].join("")
      )
    ).toBe(true);
    expect(
      getRule("Supabase access token").pattern.test(
        "SUPABASE_ACCESS_TOKEN=" + ["sbp_", "test1234567890abcdefghijklmnop"].join("")
      )
    ).toBe(true);
    expect(
      getRule("Africa's Talking API key").pattern.test(
        "AFRICASTALKING_API_KEY=" + ["atsk_", "test1234567890abcdefghijklmnop"].join("")
      )
    ).toBe(true);
    expect(
      getRule("Worker API key").pattern.test(
        "WORKER_API_KEY=" + ["example", "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/="].join("")
      )
    ).toBe(true);
  });

  it("does not flag schema builders as hardcoded Turnstile secrets", () => {
    const rule = getRule("Turnstile secret key");

    expect(rule.pattern.test("TURNSTILE_SECRET_KEY: z.string().min(1)")).toBe(false);
    rule.pattern.lastIndex = 0;
    expect(rule.pattern.test("TURNSTILE_SECRET_KEY: z")).toBe(false);
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
