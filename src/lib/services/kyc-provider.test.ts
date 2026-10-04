import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { getConfiguredProvider } from "./kyc-provider";

describe("kyc-provider", () => {
  // Pin the provider per test so a developer's .env.local cannot change the result.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("StubKycProvider via getConfiguredProvider", () => {
    beforeEach(() => {
      vi.stubEnv("KYC_PROVIDER", "stub");
    });

    it("rejects without an ID image R2 key", async () => {
      const provider = getConfiguredProvider();
      const result = await provider.submitIdentity({
        idImageR2Key: "",
        idNumber: "1234567890123",
        artifactId: "art-1",
        userId: "user-1",
      });
      expect(result.status).toBe("rejected");
      expect(result.reason).toBe("Missing ID document image");
      expect(result.providerReference).toMatch(/^sim_rej_/);
    });

    it("rejects if an ID number is provided but is not 13 characters long", async () => {
      const provider = getConfiguredProvider();
      const result = await provider.submitIdentity({
        idImageR2Key: "kyc/some-key.jpg",
        idNumber: "123",
        artifactId: "art-2",
        userId: "user-1",
      });
      expect(result.status).toBe("rejected");
      expect(result.reason).toBe("ID number must be exactly 13 digits");
      expect(result.providerReference).toMatch(/^sim_rej_/);
    });

    it("routes to manual review as a safe fallback for valid inputs", async () => {
      const provider = getConfiguredProvider();
      const result = await provider.submitIdentity({
        idImageR2Key: "kyc/some-key.jpg",
        selfieImageR2Key: "kyc/selfie.jpg",
        idNumber: "9901015009088",
        artifactId: "art-3",
        userId: "user-1",
      });
      expect(result.status).toBe("needs_manual_review");
      expect(result.reason).toContain("Routed to manual queue");
      expect(result.providerReference).toMatch(/^sim_rev_/);
    });
  });

  describe("ManualKycProvider via getConfiguredProvider", () => {
    it("rejects unsupported provider configuration instead of silently selecting the stub", () => {
      vi.stubEnv("KYC_PROVIDER", "unsupported-provider");
      expect(() => getConfiguredProvider()).toThrow("Unsupported KYC_PROVIDER");
    });

    it("routes directly to manual review with null scores", async () => {
      vi.stubEnv("KYC_PROVIDER", "manual");
      const provider = getConfiguredProvider();
      const result = await provider.submitIdentity({
        idImageR2Key: "kyc/some-key.jpg",
        selfieImageR2Key: "kyc/selfie.jpg",
        idNumber: "9901015009088",
        artifactId: "art-4",
        userId: "user-1",
      });

      expect(provider.name).toBe("manual");
      expect(result.status).toBe("needs_manual_review");
      expect(result.providerReference).toMatch(/^manual_/);
      expect(result.scores).toEqual({
        faceMatchScore: null,
        livenessScore: null,
        docAuthScore: null,
        ocrPayload: {},
        rawResponse: {},
      });
    });
  });
});
