import { describe, expect, it } from "vitest";
import {
  handoffLink,
  handoffQrCode,
  handoffSecretSchema,
  newHandoffSecret,
  phoneHandoffView,
  sha256Hex,
} from "./capture-handoff";

describe("phone link secrets", () => {
  it("are 32 random bytes, different every time, and stored only as SHA-256", () => {
    const a = newHandoffSecret();
    const b = newHandoffSecret();
    expect(a).not.toBe(b);
    expect(handoffSecretSchema.safeParse(a).success).toBe(true);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(sha256Hex(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Hex(a)).not.toContain(a);
    // A short typed code is never accepted.
    expect(handoffSecretSchema.safeParse("123456").success).toBe(false);
  });

  it("travel in the link's fragment, never its path or query", () => {
    const token = newHandoffSecret();
    const link = new URL(handoffLink("https://verifymzansi.com", token));
    expect(link.pathname).toBe("/verify/continue");
    expect(link.search).toBe("");
    expect(link.hash).toBe(`#${token}`);
  });

  it("draw a QR code on the server as one path", () => {
    const qr = handoffQrCode(handoffLink("https://verifymzansi.com", newHandoffSecret()));
    expect(qr.size).toBeGreaterThanOrEqual(29);
    expect(qr.path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
  });

  it("never show the phone the account id", () => {
    const view = phoneHandoffView({
      owner_id: "11111111-1111-4111-8111-111111111111",
      expires_at: "2026-11-20T12:15:00Z",
      public_name: "Thando D.",
      needs_id: true,
      needs_selfie: true,
    });
    expect(JSON.stringify(view)).not.toContain("11111111");
    expect(view).toEqual({
      publicName: "Thando D.",
      expiresAt: "2026-11-20T12:15:00Z",
      needsId: true,
      needsSelfie: true,
    });
  });
});
