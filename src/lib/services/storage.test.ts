import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock references are available when vi.mock factories run
const { mockSend, mockGetSignedUrl, mockEncryptFile, mockDecryptFile, mockS3ClientConfigs } =
  vi.hoisted(() => ({
    mockSend: vi.fn().mockResolvedValue({}),
    mockGetSignedUrl: vi.fn().mockResolvedValue("https://signed-url.example.com"),
    mockEncryptFile: vi.fn().mockResolvedValue(Buffer.from("encrypted-data")),
    mockDecryptFile: vi.fn().mockReturnValue(Buffer.from("decrypted-data")),
    mockS3ClientConfigs: [] as unknown[],
  }));

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send = mockSend;
    constructor(config?: unknown) {
      mockS3ClientConfigs.push(config);
    }
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
  hasR2WriteAccess,
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
    delete (globalThis as Record<string, unknown>).env;
    delete (globalThis as Record<string, unknown>).__env__;
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

    it("falls back to a safe extension for extensionless filenames", () => {
      // "noext" has no dot — the whole filename must not become the extension
      const key = generateStorageKey("photos", "s3", "noext");
      expect(key).toMatch(/\.jpg$/);
    });

    it("derives the extension from the declared MIME type for extensionless filenames", () => {
      // Android content-picker files arrive without an extension
      const key = generateStorageKey("media/listing", "user-1", "1000061870", "image/png");
      expect(key).toMatch(/^media\/listing\/user-1\/\d+-[a-z0-9]+\.png$/);
    });

    it("derives the extension from the declared MIME type when the filename extension is numeric", () => {
      const key = generateStorageKey("media/listing", "user-1", "clip.12345", "video/mp4");
      expect(key).toMatch(/\.mp4$/);
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

  describe("R2 client configuration", () => {
    it("disables SDK default checksums for R2 compatibility", async () => {
      // Force a fresh client construction (the singleton is keyed by credentials)
      process.env.R2_ACCOUNT_ID = "checksum-account";
      await deleteFromR2("my-bucket", "some/key.jpg");

      expect(mockS3ClientConfigs.at(-1)).toMatchObject({
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
    });
  });

  describe("generatePresignedUploadUrl", () => {
    it("returns a signed URL", async () => {
      const url = await generatePresignedUploadUrl("bucket", "key", "image/png");
      expect(url).toBe("https://signed-url.example.com");
    });

    it("pins the declared Content-Type into the signature", async () => {
      await generatePresignedUploadUrl("bucket", "key", "video/mp4", 3600, 1024);
      expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
      const [, command, options] = mockGetSignedUrl.mock.calls[0];
      expect(command.params).toMatchObject({ ContentType: "video/mp4", ContentLength: 1024 });
      expect(options.signableHeaders).toBeInstanceOf(Set);
      expect([...options.signableHeaders]).toContain("content-type");
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

    it("uses a native Cloudflare R2 binding from global env when available", async () => {
      const put = vi.fn().mockResolvedValue(undefined);
      const get = vi.fn();
      const del = vi.fn();
      (globalThis as Record<string, unknown>).env = {
        PRIVATE_BUCKET: {
          put,
          get,
          delete: del,
        },
      };

      const file = new Blob(["id doc content"]);
      const result = await uploadKycDocument(file, "seller-1", "id_document");

      expect(put).toHaveBeenCalledTimes(1);
      expect(mockSend).not.toHaveBeenCalled();
      expect(result.url).toMatch(/^private:\/\/verifymzansi-private\//);
    });
  });

  describe("hasR2WriteAccess", () => {
    it("returns true when a native Cloudflare R2 binding exists on global env", async () => {
      (globalThis as Record<string, unknown>).env = {
        PRIVATE_BUCKET: {
          put: vi.fn(),
          get: vi.fn(),
          delete: vi.fn(),
        },
      };

      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;

      await expect(hasR2WriteAccess("verifymzansi-private")).resolves.toBe(true);
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

    it("downloads via a native Cloudflare R2 binding when available", async () => {
      const get = vi.fn().mockResolvedValue({
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        size: 3,
        httpMetadata: { contentType: "application/octet-stream" },
      });
      (globalThis as Record<string, unknown>).env = {
        PRIVATE_BUCKET: {
          put: vi.fn(),
          get,
          delete: vi.fn(),
        },
      };

      const buffer = await downloadKycDocument("kyc/id_document/seller-1/file.bin");

      expect(get).toHaveBeenCalledTimes(1);
      expect(mockSend).not.toHaveBeenCalled();
      expect(buffer).toEqual(Buffer.from("decrypted-data"));
    });
  });

  describe("getKycDocumentViewUrl", () => {
    it("returns a presigned URL for KYC document", async () => {
      const url = await getKycDocumentViewUrl("kyc/doc.bin");
      expect(url).toBe("https://signed-url.example.com");
    });
  });
});
