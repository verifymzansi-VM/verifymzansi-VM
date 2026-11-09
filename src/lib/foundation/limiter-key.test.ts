/** @vitest-environment node */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { limiterAccountAddressKey, limiterAddressKey } from "./limiter-key";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("rate limiter keys for typed values", () => {
  it("keys an address by a SHA-256 digest, never the address itself", async () => {
    const key = await limiterAddressKey("member@example.invalid");
    expect(key).toBe("email:" + sha256("email\nmember@example.invalid"));
    expect(key).not.toContain("member");
    expect(key).toMatch(/^email:[0-9a-f]{64}$/);
  });

  it("keeps every key the same short length, however long the address", async () => {
    const long = `${"a".repeat(240)}@example.invalid`;
    const key = await limiterAddressKey(long);
    // The limiter refuses keys over 160 characters.
    expect(key.length).toBe(70);
    expect(
      (await limiterAccountAddressKey("00000000-0000-4000-8000-000000000001", long)).length
    ).toBe(78);
  });

  it("gives different addresses, accounts and kinds different keys", async () => {
    const account = "00000000-0000-4000-8000-000000000001";
    const other = "00000000-0000-4000-8000-000000000002";
    const keys = [
      await limiterAddressKey("a@example.invalid"),
      await limiterAddressKey("b@example.invalid"),
      await limiterAccountAddressKey(account, "a@example.invalid"),
      await limiterAccountAddressKey(other, "a@example.invalid"),
      await limiterAccountAddressKey(account, "b@example.invalid"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[2]).toBe("account-email:" + sha256(`account-email\n${account}\na@example.invalid`));
  });
});
