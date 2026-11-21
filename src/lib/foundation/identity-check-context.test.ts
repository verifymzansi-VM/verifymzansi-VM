/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deviceOfPlatform,
  deviceOfUserAgent,
  networkOf,
  openStartContext,
  sealStartContext,
  sessionMoved,
  type IdentityCheckStartContext,
} from "./identity-check-context";
vi.mock("server-only", () => ({}));

const check = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const context: IdentityCheckStartContext = {
  owner: "33333333-3333-4333-8333-333333333333",
  first: "Thando Sipho",
  last: "Dlamini",
  network: "4:198.51.100",
  device: "handheld",
};

beforeEach(() => {
  vi.stubEnv("ID_ENCRYPTION_KEY", "fedcba9876543210".repeat(4));
});

describe("the sealed start context", () => {
  it("opens only for its own check and holds no readable personal data", () => {
    const sealed = sealStartContext(check, context);
    expect(openStartContext(check, sealed)).toEqual(context);
    expect(openStartContext(other, sealed)).toBeNull();
    for (const visible of ["Thando", "Dlamini", "198.51", context.owner])
      expect(sealed).not.toContain(visible);
    // A fresh IV each time.
    expect(sealStartContext(check, context)).not.toBe(sealed);
  });

  it("refuses an altered, missing or foreign value", () => {
    const sealed = sealStartContext(check, context);
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
    for (const value of [flipped, "", null, undefined, "v2." + sealed.slice(3), "v1.abc"])
      expect(openStartContext(check, value)).toBeNull();
    vi.stubEnv("ID_ENCRYPTION_KEY", "0123456789abcdef".repeat(4));
    expect(openStartContext(check, sealed)).toBeNull();
  });
});

describe("network and device", () => {
  it("reads the /24 or /48 network of an address", () => {
    expect(networkOf("198.51.100.7")).toBe("4:198.51.100");
    expect(networkOf(" 198.51.100.250 ")).toBe("4:198.51.100");
    expect(networkOf("2001:db8:0:1::5")).toBe("6:2001:db8:0");
    expect(networkOf("2001:0DB8:0000:0001:0000:0000:0000:0005")).toBe("6:2001:db8:0");
    expect(networkOf("::1")).toBe("6:0:0:0");
    for (const bad of ["", null, "unknown", "300.1.1.1", "1.2.3", "1::2::3", "1:2:3", "12345::1"])
      expect(networkOf(bad)).toBeNull();
  });

  it("tells a phone or tablet from a computer, in both descriptions", () => {
    expect(
      deviceOfUserAgent("Mozilla/5.0 (Linux; Android 14; SM-A146P) Mobile Safari/537.36")
    ).toBe("handheld");
    expect(deviceOfUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)")).toBe(
      "handheld"
    );
    expect(deviceOfUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131")).toBe(
      "desktop"
    );
    expect(deviceOfUserAgent(null)).toBe("desktop");
    expect(deviceOfPlatform("mobile")).toBe("handheld");
    expect(deviceOfPlatform("Tablet")).toBe("handheld");
    expect(deviceOfPlatform("desktop")).toBe("desktop");
    expect(deviceOfPlatform("tv")).toBeNull();
  });
});

describe("a check that moved away from where it started (scam lure)", () => {
  const start = { network: "4:198.51.100", device: "handheld" as const };

  it("stays when the partner saw the same network and kind of device", () => {
    expect(sessionMoved(start, { ip_address: "198.51.100.99", platform: "mobile" })).toBe(false);
  });

  it("moved when the network or the device differs", () => {
    expect(sessionMoved(start, { ip_address: "203.0.113.5", platform: "mobile" })).toBe(true);
    expect(sessionMoved(start, { ip_address: "198.51.100.99", platform: "desktop" })).toBe(true);
  });

  it("moved when the partner reports no IP analysis at all (fail closed)", () => {
    expect(sessionMoved(start, undefined)).toBe(true);
  });

  it("compares a network only between addresses of the same kind", () => {
    expect(sessionMoved(start, { ip_address: "2001:db8::1", platform: "mobile" })).toBe(false);
    expect(
      sessionMoved(
        { network: null, device: "desktop" },
        { ip_address: "203.0.113.5", platform: "desktop" }
      )
    ).toBe(false);
    expect(
      sessionMoved(
        { network: "6:2001:db8:0", device: "desktop" },
        { ip_address: "2001:db8:1::1", platform: "desktop" }
      )
    ).toBe(true);
  });
});
