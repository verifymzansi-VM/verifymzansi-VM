import { describe, it, expect } from "vitest";

// Test that the barrel file re-exports correctly
// We can import types and check they exist

describe("services index barrel", () => {
  it("re-exports all service modules", { timeout: 15_000 }, async () => {
    const services = await import("./index");

    // Entitlements
    expect(typeof services.getPlan).toBe("function");
    expect(typeof services.getEntitlements).toBe("function");
    expect(typeof services.canCreateListing).toBe("function");
    expect(typeof services.canBoost).toBe("function");

    // Audit
    expect(typeof services.logAuditEvent).toBe("function");

    // Enforcement
    expect(typeof services.enforceAction).toBe("function");

    // Consent
    expect(typeof services.updateConsent).toBe("function");
    expect(typeof services.getConsents).toBe("function");

    // Storage
    expect(typeof services.uploadToR2).toBe("function");
    expect(typeof services.generateStorageKey).toBe("function");
    expect(typeof services.deleteFromR2).toBe("function");
  });
});
