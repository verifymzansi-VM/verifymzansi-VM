/** @vitest-environment node */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { hasRuntimeDiagnosticAccess, verifyRuntimeBindings } from "./runtime-bindings";
const value = "synthetic-runtime-value";
const digest = createHash("sha256").update(value).digest("hex");
it("compares actual bindings without disclosing secret values or digests", () => {
  const result = verifyRuntimeBindings(
    { HMAC_SECRET: value },
    { expected: { HMAC_SECRET: digest } }
  );
  expect(result).toEqual({ ok: true, checks: { HMAC_SECRET: { present: true, matches: true } } });
  expect(JSON.stringify(result)).not.toContain(value);
  expect(JSON.stringify(result)).not.toContain(digest);
});
it("distinguishes a missing binding from a mismatched binding", () => {
  expect(
    verifyRuntimeBindings(
      { HMAC_SECRET: "other" },
      { expected: { HMAC_SECRET: digest, ID_ENCRYPTION_KEY: digest } }
    )
  ).toEqual({
    ok: false,
    checks: {
      HMAC_SECRET: { present: true, matches: false },
      ID_ENCRYPTION_KEY: { present: false, matches: false },
    },
  });
});
it.each([
  { expected: {} },
  { expected: { PATH: digest } },
  { expected: { HMAC_SECRET: value } },
  { expected: { HMAC_SECRET: digest }, extra: true },
])("rejects unexpected names, malformed hashes and empty checks", (input) => {
  expect(() => verifyRuntimeBindings({}, input)).toThrow();
});
it("requires the dedicated full diagnostic credential", () => {
  const key = "test-diagnostic-credential-".repeat(2);
  expect(hasRuntimeDiagnosticAccess(`Bearer ${key}`, key)).toBe(true);
  for (const header of [null, key, "Bearer wrong", `Bearer ${key}x`])
    expect(hasRuntimeDiagnosticAccess(header, key)).toBe(false);
  expect(hasRuntimeDiagnosticAccess("Bearer short", "short")).toBe(false);
});
