/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { clientNetworkKey } from "./client-network-key";

const from = (headers: Record<string, string>) =>
  new Request("https://verifymzansi.com/api/auth/register", { method: "POST", headers });

describe("clientNetworkKey", () => {
  it("keys an IPv4 address by itself", () => {
    expect(clientNetworkKey(from({ "cf-connecting-ip": "198.51.100.7" }))).toBe("v4:198.51.100.7");
  });

  it("keys every address of one IPv6 /48 the same", () => {
    const keys = ["2001:db8:1:2::1", "2001:0db8:0001:ffff:aaaa::9", "[2001:db8:1::]"].map((ip) =>
      clientNetworkKey(from({ "cf-connecting-ip": ip }))
    );
    expect(new Set(keys)).toEqual(new Set(["v6:2001:db8:1::/48"]));
    expect(clientNetworkKey(from({ "cf-connecting-ip": "2001:db8:2::1" }))).toBe(
      "v6:2001:db8:2::/48"
    );
  });

  it("keys an IPv4-mapped IPv6 address as its IPv4 address", () => {
    expect(clientNetworkKey(from({ "cf-connecting-ip": "::ffff:198.51.100.7" }))).toBe(
      "v4:198.51.100.7"
    );
    expect(clientNetworkKey(from({ "cf-connecting-ip": "::ffff:c633:6407" }))).toBe(
      "v4:198.51.100.7"
    );
  });

  it("falls back to the request's identity for a malformed or missing address", () => {
    expect(clientNetworkKey(from({ "cf-connecting-ip": "2001:db8::1::2" }))).toBe("2001:db8::1::2");
    expect(clientNetworkKey(from({ "user-agent": "Synthetic" }))).toMatch(/^fp:[0-9a-f]{8}$/);
  });
});
