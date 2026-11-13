import { describe, expect, it } from "vitest";
import {
  clearCachedKycArtifactBlobs,
  getCachedKycArtifactBlob,
  setCachedKycArtifactBlob,
} from "./kyc-artifact-blob-cache";

describe("kyc-artifact-blob-cache", () => {
  it("never reuses an artifact-only cache in the claim-bound workflow", () => {
    const blob = new Blob(["private fixture"], { type: "image/jpeg" });
    expect(getCachedKycArtifactBlob("missing-id")).toBeNull();
    setCachedKycArtifactBlob("artifact", blob);
    expect(getCachedKycArtifactBlob("artifact")).toBeNull();
    clearCachedKycArtifactBlobs();
    expect(getCachedKycArtifactBlob("artifact")).toBeNull();
  });
});
