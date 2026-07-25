import { beforeEach, describe, expect, it } from "vitest";

/**
 * Exercises generatePresignedUploadUrl with the REAL @aws-sdk presigner (no
 * mocks) so the emitted query parameters can be inspected directly. Signing
 * is purely local — no network calls are made.
 */
import { generatePresignedUploadUrl } from "./storage";

describe("generatePresignedUploadUrl (real signer)", () => {
  beforeEach(() => {
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
  });

  it("pins content-type in the signed headers", async () => {
    const url = await generatePresignedUploadUrl(
      "verifymzansi-public",
      "media/listing/user-1/clip.mp4",
      "video/mp4",
      3600,
      2048
    );

    const parsed = new URL(url);
    const signedHeaders = (parsed.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(signedHeaders).toContain("content-type");
    expect(signedHeaders).toContain("content-length");
  });

  it("does not embed SDK default empty-body checksum params", async () => {
    const url = await generatePresignedUploadUrl(
      "verifymzansi-public",
      "media/listing/user-1/clip.mp4",
      "video/mp4",
      3600,
      2048
    );

    const parsed = new URL(url);
    const paramNames = [...parsed.searchParams.keys()].map((name) => name.toLowerCase());
    expect(paramNames).not.toContain("x-amz-checksum-crc32");
    expect(paramNames).not.toContain("x-amz-sdk-checksum-algorithm");
    expect(url).not.toContain("x-amz-checksum-crc32");
    expect(url).not.toContain("x-amz-sdk-checksum-algorithm");
  });
});
