import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecoveryProof, verifyRecoveryProof } from "./password-recovery";

describe("recovery redemption proof", () => {
  beforeEach(() => vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "isolated-test-signing-key"));
  afterEach(() => vi.unstubAllEnvs());

  const token = (sub = "user-1", session_id = "session-1") =>
    `header.${Buffer.from(JSON.stringify({ sub, session_id })).toString("base64url")}.signature`;

  it("accepts successful redemption only for the same user and session", () => {
    const proof = createRecoveryProof("user-1", token())!;
    expect(verifyRecoveryProof(proof, "user-1", "session-1")).toBe(true);
    expect(verifyRecoveryProof(proof, "user-2", "session-1")).toBe(false);
    expect(verifyRecoveryProof(proof, "user-1", "other-session")).toBe(false);
    expect(createRecoveryProof("user-2", token())).toBe(null);
  });

  it("rejects forged, malformed, expired and future-dated proofs", () => {
    const now = Math.floor(Date.now() / 1000);
    const proof = createRecoveryProof("user-1", token())!;
    expect(verifyRecoveryProof("user-1", "user-1", "session-1")).toBe(false);
    expect(verifyRecoveryProof(`${proof}x`, "user-1", "session-1")).toBe(false);
    expect(verifyRecoveryProof(proof, "user-1", "session-1", now + 3601)).toBe(false);
    expect(verifyRecoveryProof(proof, "user-1", "session-1", now - 1)).toBe(false);
  });

  it("fails closed without the signing key", () => {
    const proof = createRecoveryProof("user-1", token())!;
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(verifyRecoveryProof(proof, "user-1", "session-1")).toBe(false);
  });
});

it("enables the TOTP APIs required by staff access in the local Supabase stack", () => {
  const config = fs.readFileSync("supabase/config.toml", "utf8");
  const totp = config.split("[auth.mfa.totp]")[1].split("[auth.mfa.phone]")[0];
  expect(totp).toMatch(/^enroll_enabled = true$/m);
  expect(totp).toMatch(/^verify_enabled = true$/m);
});
