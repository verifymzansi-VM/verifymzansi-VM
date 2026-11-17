/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { foundationVerificationCookies, foundationVerifierCookieWrites } from "./auth-attempt";

vi.mock("server-only", () => ({}));

const base = "sb-abcdefghijklmnopqrst-auth-token";
const write = (name: string, value: string, maxAge?: number) => ({
  name,
  value,
  options: maxAge === undefined ? {} : { maxAge },
});

describe("foundationVerifierCookieWrites", () => {
  const items = [
    write(`${base}-flow-${"a".repeat(32)}-code-verifier`, "base64-new"),
    write(`${base}-flow-${"b".repeat(32)}-code-verifier`, "", 0),
    write(`${base}-flows-code-verifier`, "base64-index"),
    write(`${base}-code-verifier`, "base64-fixed"),
    write(`${base}-code-verifier.1`, "", 0),
    write(base, "", 0),
    write(`${base}.0`, "", 0),
    write(`${base}.1`, "base64-session"),
    write("vm_csrf", "synthetic"),
  ];

  it("keeps every verifier write, removals included, and no session cookie", () => {
    expect(foundationVerifierCookieWrites(items).map((item) => item.name)).toEqual([
      `${base}-flow-${"a".repeat(32)}-code-verifier`,
      `${base}-flow-${"b".repeat(32)}-code-verifier`,
      `${base}-flows-code-verifier`,
      `${base}-code-verifier`,
      `${base}-code-verifier.1`,
    ]);
  });

  it("differs from the set-only filter in keeping removals", () => {
    expect(foundationVerificationCookies(items).map((item) => item.name)).toEqual([
      `${base}-flow-${"a".repeat(32)}-code-verifier`,
      `${base}-flows-code-verifier`,
      `${base}-code-verifier`,
    ]);
  });
});
