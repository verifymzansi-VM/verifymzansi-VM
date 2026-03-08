import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock references are available when vi.mock factories run
const { mockSend, mockGetSignedUrl, mockEncryptFile, mockDecryptFile } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
  mockGetSignedUrl: vi.fn().mockResolvedValue("https://signed-url.example.com"),
  mockEncryptFile: vi.fn().mockResolvedValue(Buffer.from("encrypted-data")),
  mockDecryptFile: vi.fn().mockReturnValue(Buffer.from("decrypted-data")),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send = mockSend;
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: class {
      constructor(public params: unknown) {}
    },
    DeleteObjectCommand: class {
      constructor(public params: unknown) {}
    },
    GetObjectCommand: class {
      constructor(public params: unknown) {}
    },
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock("@/lib/utils/encryption", () => ({
  encryptFile: mockEncryptFile,
  decryptFile: mockDecryptFile,
}));

import {
  uploadToR2,
  generateStorageKey,
  deleteFromR2,
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  uploadKycDocument,
  downloadKycDocument,
  getKycDocumentViewUrl,
} from "./storage";

describe("storage service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
    process.env.R2_PUBLIC_URL = "https://cdn.verifymzansi.com";
    process.env.R2_PRIVATE_BUCKET = "verifymzansi-private";
  });

  describe("generateStorageKey", () => {
    it("generates key with correct prefix and seller ID", () => {
      const key = generateStorageKey("listings", "seller-1", "photo.jpg");
      expect(key).toMatch(/^listings\/seller-1\/\d+-[a-z0-9]+\.jpg$/);
    });

    it("extracts file extension correctly", () => {
      const key = generateStorageKey("kyc", "s2", "document.pdf");
      expect(key).toMatch(/\.pdf$/);
    });

    it("uses last segment after dot as extension", () => {
      // "noext" has no dot, so split(".").pop() returns "noext" itself
      const key = generateStorageKey("photos", "s3", "noext");
      expect(key).toMatch(/\.noext$/);
    });

    it("generates unique keys each call", () => {
      const k1 = generateStorageKey("a", "b", "c.png");
      const k2 = generateStorageKey("a", "b", "c.png");
      // Different timestamp or random component
      expect(k1).not.toBe(k2);
    });
  });

  describe("uploadToR2", () => {
    it("uploads file and returns URL with public URL", async () => {
      const file = new Blob(["file content"], { type: "image/jpeg" });
      const result = await uploadToR2({
        bucket: "verifymzansi-public",
        key: "listings/s1/photo.jpg",
        file,
        contentType: "image/jpeg",
      });

      expect(mockSend).toHaveBeenCalled();
      expect(result.url).toBe("https://cdn.verifymzansi.com/listings/s1/photo.jpg");
      expect(result.key).toBe("listings/s1/photo.jpg");
    });

    it("falls back to bucket URL when R2_PUBLIC_URL not set", async () => {
      delete process.env.R2_PUBLIC_URL;
      const file = new Blob(["data"]);
      const result = await uploadToR2({
        bucket: "my-bucket",
        key: "test.jpg",
        file,
        contentType: "image/jpeg",
      });

      expect(result.url).toContain("my-bucket");
      expect(result.url).toContain("test.jpg");
    });
  });

  describe("deleteFromR2", () => {
    it("sends DeleteObjectCommand", async () => {
      await deleteFromR2("my-bucket", "some/key.jpg");
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe("generatePresignedUploadUrl", () => {
    it("returns a signed URL", async () => {
      const url = await generatePresignedUploadUrl("bucket", "key", "image/png");
      expect(url).toBe("https://signed-url.example.com");
    });
  });

  describe("generatePresignedDownloadUrl", () => {
    it("returns a signed URL", async () => {
      const url = await generatePresignedDownloadUrl("bucket", "key");
      expect(url).toBe("https://signed-url.example.com");
    });
  });

  describe("uploadKycDocument", () => {
    it("encrypts and uploads KYC document", async () => {
      const file = new Blob(["id doc content"]);
      const result = await uploadKycDocument(file, "seller-1", "id_document");

      expect(result.url).toMatch(/^private:\/\//);
      expect(result.key).toMatch(/^kyc\/id_document\/seller-1\//);
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe("path traversal protection", () => {
    it("rejects keys with parent directory traversal", async () => {
      await expect(downloadKycDocument("../etc/passwd")).rejects.toThrow("Invalid storage key");
    });

    it("rejects keys with URL-encoded traversal", async () => {
      await expect(downloadKycDocument("kyc/%2e%2e/etc/passwd")).rejects.toThrow(
        "Invalid storage key"
      );
    });

    it("rejects keys with null bytes", async () => {
      await expect(downloadKycDocument("kyc/file\0.bin")).rejects.toThrow("Invalid storage key");
    });

    it("rejects keys with URL-encoded null bytes", async () => {
      await expect(downloadKycDocument("kyc/file%00.bin")).rejects.toThrow("Invalid storage key");
    });

    it("rejects keys with backslashes", async () => {
      await expect(downloadKycDocument("kyc\\file.bin")).rejects.toThrow("Invalid storage key");
    });

    it("allows valid storage keys", async () => {
      const chunks = [new Uint8Array([1, 2, 3])];
      mockSend.mockResolvedValueOnce({
        Body: {
          async transformToByteArray() {
            return new Uint8Array(chunks[0]);
          },
        },
      });
      // Should not throw for valid key
      const buffer = await downloadKycDocument("kyc/id_document/seller-1/12345-abcd1234.bin");
      expect(buffer).toEqual(Buffer.from("decrypted-data"));
    });
  });

  describe("downloadKycDocument", () => {
    it("downloads and decrypts KYC document", async () => {
      // Mock S3 response body with transformToByteArray (AWS SDK portable helper)
      const chunks = [new Uint8Array([1, 2, 3])];
      mockSend.mockResolvedValueOnce({
        Body: {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) yield chunk;
          },
          async transformToByteArray() {
            const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
            let offset = 0;
            for (const c of chunks) {
              all.set(c, offset);
              offset += c.length;
            }
            return all;
          },
        },
      });

      const buffer = await downloadKycDocument("kyc/id_document/seller-1/file.bin");
      expect(buffer).toEqual(Buffer.from("decrypted-data"));
    });

    it("throws when response body is empty", async () => {
      mockSend.mockResolvedValueOnce({ Body: null });

      await expect(downloadKycDocument("kyc/missing.bin")).rejects.toThrow(
        "Failed to download KYC document"
      );
    });
  });

  describe("getKycDocumentViewUrl", () => {
    it("returns a presigned URL for KYC document", async () => {
      const url = await getKycDocumentViewUrl("kyc/doc.bin");
      expect(url).toBe("https://signed-url.example.com");
    });
  });
});
