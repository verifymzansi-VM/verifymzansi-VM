/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deviceOfPlatform,
  deviceOfUserAgent,
  networkHash,
  networkOf,
  sessionMoved,
} from "./identity-check-context";
vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4));
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

  it("keeps only a keyed hash of the network", () => {
    const hash = networkHash("198.51.100.7");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(networkHash("198.51.100.200"));
    expect(hash).not.toBe(networkHash("198.51.101.7"));
    expect(networkHash("2001:db8::1")).toMatch(/^[a-f0-9]{64}$/);
    expect(networkHash("unknown")).not.toBe(hash);
    // Another key gives another hash: the network cannot be read back.
    vi.stubEnv("HMAC_SECRET", "fedcba9876543210".repeat(4));
    expect(networkHash("198.51.100.7")).not.toBe(hash);
  });

  it("tells a phone or tablet from a computer, in both descriptions", () => {
    expect(
      deviceOfUserAgent("Mozilla/5.0 (Linux; Android 14; SM-A146P) Mobile Safari/537.36")
    ).toBe("phone");
    expect(deviceOfUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)")).toBe(
      "phone"
    );
    expect(deviceOfUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131")).toBe(
      "computer"
    );
    expect(deviceOfUserAgent(null)).toBe("computer");
    expect(deviceOfPlatform("mobile")).toBe("phone");
    expect(deviceOfPlatform("Tablet")).toBe("phone");
    expect(deviceOfPlatform("desktop")).toBe("computer");
    expect(deviceOfPlatform("tv")).toBeNull();
  });
});

describe("a check that moved away from where it started (scam lure)", () => {
  const start = () => ({ network_hash: networkHash("198.51.100.7"), device_kind: "phone" });

  it("stays when the partner saw the same network and kind of device", () => {
    expect(sessionMoved(start(), { ip_address: "198.51.100.99", platform: "mobile" })).toBe(false);
  });

  it("moved when the network or the device differs", () => {
    expect(sessionMoved(start(), { ip_address: "203.0.113.5", platform: "mobile" })).toBe(true);
    expect(sessionMoved(start(), { ip_address: "198.51.100.99", platform: "desktop" })).toBe(true);
  });

  it("moved when the partner reports no IP analysis, or the start was not recorded (fail closed)", () => {
    expect(sessionMoved(start(), undefined)).toBe(true);
    expect(
      sessionMoved(
        { network_hash: null, device_kind: null },
        { ip_address: "198.51.100.99", platform: "mobile" }
      )
    ).toBe(true);
  });

  it("moved when either address is unreadable, missing or of another kind (fail closed)", () => {
    for (const ip_address of ["2001:db8::1", null, "unknown", ""])
      expect(sessionMoved(start(), { ip_address, platform: "mobile" })).toBe(true);
    const unreadableStart = { network_hash: networkHash("unknown"), device_kind: "computer" };
    expect(sessionMoved(unreadableStart, { ip_address: "203.0.113.5", platform: "desktop" })).toBe(
      true
    );
    expect(sessionMoved(unreadableStart, { ip_address: "unknown", platform: "desktop" })).toBe(
      true
    );
    const v6 = { network_hash: networkHash("2001:db8:0::5"), device_kind: "computer" };
    expect(sessionMoved(v6, { ip_address: "2001:db8:0:9::1", platform: "desktop" })).toBe(false);
    expect(sessionMoved(v6, { ip_address: "2001:db8:1::1", platform: "desktop" })).toBe(true);
  });

  it("moved when the partner does not name the device", () => {
    expect(sessionMoved(start(), { ip_address: "198.51.100.99", platform: "tv" })).toBe(true);
    expect(sessionMoved(start(), { ip_address: "198.51.100.99" })).toBe(true);
  });
});
