import { describe, it, expect } from "vitest";
import { getConfiguredProvider } from "./kyc-provider";

describe("kyc-provider", () => {
  describe("StubKycProvider via getConfiguredProvider", () => {
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
});
