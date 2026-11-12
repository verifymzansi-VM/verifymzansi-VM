import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock references are available when vi.mock factories run
const {
  mockSend,
  mockGetSignedUrl,
  mockEncryptFile,
  mockDecryptFile,
  mockS3ClientConfigs,
  mockSendClientConfigs,
} = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
  mockGetSignedUrl: vi.fn().mockResolvedValue("https://signed-url.example.com"),
  mockEncryptFile: vi.fn().mockResolvedValue(Buffer.from("encrypted-data")),
  mockDecryptFile: vi.fn().mockReturnValue(Buffer.from("decrypted-data")),
  mockS3ClientConfigs: [] as unknown[],
  /** The constructor config of the client behind each send, in call order. */
  mockSendClientConfigs: [] as unknown[],
}));

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send: typeof mockSend;
    constructor(config?: unknown) {
      mockS3ClientConfigs.push(config);
      this.send = ((...args: unknown[]) => {
        mockSendClientConfigs.push(config);
        return mockSend(...args);
      }) as typeof mockSend;
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
    DeleteObjectsCommand: class {
      readonly batch = true;
      constructor(public params: unknown) {}
    },
    GetObjectCommand: class {
      constructor(public params: unknown) {}
    },
    HeadObjectCommand: class {
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
  deleteManyFromR2,
  generatePresignedDownloadUrl,
  uploadKycDocument,
  downloadKycDocument,
  hasR2WriteAccess,
  getR2ObjectSize,
  getR2ObjectBytes,
  putImmutableR2Bytes,
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

  describe("immutable evidence writes", () => {
    it("supports ordinary encrypted uploads with a native binding and no S3 credentials", async () => {
      const put = vi.fn().mockResolvedValue({ etag: "fixture" });
      (globalThis as Record<string, unknown>).__env__ = {
        PRIVATE_BUCKET: { put, get: vi.fn(), head: vi.fn(), delete: vi.fn() },
      };
      const result = await uploadToR2({
        bucket: "verifymzansi-private",
        key: "evidence/fixture/object",
        file: new Blob(["encrypted"]),
        contentType: "application/octet-stream",
      });
      expect(result.key).toBe("evidence/fixture/object");
      expect(put).toHaveBeenCalledWith("evidence/fixture/object", expect.any(Uint8Array), {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "private, no-store",
        },
      });
      expect(mockSend).not.toHaveBeenCalled();
    });
    it("uses the native conditional write and returns its winning ciphertext", async () => {
      const put = vi.fn().mockResolvedValue({ etag: "fixture" });
      (globalThis as Record<string, unknown>).__env__ = {
        PRIVATE_BUCKET: { put, get: vi.fn(), head: vi.fn(), delete: vi.fn() },
      };
      const bytes = Buffer.from("first ciphertext");
      expect(
        await putImmutableR2Bytes("verifymzansi-private", "evidence/fixture/object", bytes)
      ).toEqual(bytes);
      expect(put).toHaveBeenCalledWith(
        "evidence/fixture/object",
        expect.any(Uint8Array),
        expect.objectContaining({
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: {
            contentType: "application/octet-stream",
            cacheControl: "private, no-store",
          },
        })
      );
      expect(mockSend).not.toHaveBeenCalled();
    });
    it("reads the existing winner on a conditional conflict without overwriting it", async () => {
      const old = Buffer.from("winning ciphertext");
      const put = vi.fn().mockResolvedValue(null),
        get = vi.fn().mockResolvedValue({ arrayBuffer: async () => new Uint8Array(old).buffer });
      (globalThis as Record<string, unknown>).__env__ = {
        PRIVATE_BUCKET: { put, get, head: vi.fn(), delete: vi.fn() },
      };
      expect(
        await putImmutableR2Bytes(
          "verifymzansi-private",
          "evidence/fixture/object",
          Buffer.from("loser")
        )
      ).toEqual(old);
      expect(put).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith("evidence/fixture/object");
    });
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

    it("single-attempt deletes use a client without SDK retries; ordinary deletes keep them", async () => {
      process.env.R2_ACCOUNT_ID = "attempts-account";
      mockSendClientConfigs.length = 0;
      await deleteFromR2("my-bucket", "some/key.jpg");
      await deleteFromR2("my-bucket", "some/key.jpg", { attempts: "single-attempt" });
      await deleteFromR2("my-bucket", "some/key.jpg", { attempts: "single-attempt" });
      expect(mockSendClientConfigs).toHaveLength(3);
      expect(mockSendClientConfigs[0]).not.toHaveProperty("maxAttempts");
      expect(mockSendClientConfigs[1]).toMatchObject({
        maxAttempts: 1,
        requestChecksumCalculation: "WHEN_REQUIRED",
      });
      // Both clients are cached: no new client for the repeated call.
      expect(mockSendClientConfigs[2]).toBe(mockSendClientConfigs[1]);
    });

    it("single-attempt deletes honour the caller's signal and report busy storage", async () => {
      const caller = new AbortController();
      const slowDown = () => Object.assign(new Error("slow"), { name: "SlowDown", $metadata: {} });
      let signalled = false;
      mockSend.mockImplementationOnce(async (_command, options) => {
        caller.abort();
        signalled = options.abortSignal.aborted;
        throw slowDown();
      });
      await expect(
        deleteFromR2("my-bucket", "some/key.jpg", {
          attempts: "single-attempt",
          signal: caller.signal,
        })
      ).rejects.toMatchObject({ retryLater: true, name: "StorageRetryLaterError" });
      expect(signalled).toBe(true);
      // Ordinary deletes keep the original error.
      mockSend.mockRejectedValueOnce(slowDown());
      await expect(deleteFromR2("my-bucket", "some/key.jpg")).rejects.toMatchObject({
        name: "SlowDown",
      });
    });
  });

  describe("deleteManyFromR2", () => {
    const keys = ["media/a", "media/a.w400.webp", "media/a.w800.webp"];
    const allDeleted = { Deleted: keys.map((Key) => ({ Key })) };

    it("deletes the keys with one DeleteObjects request that lists them, and no SDK retries", async () => {
      process.env.R2_ACCOUNT_ID = "batch-account";
      mockSendClientConfigs.length = 0;
      mockSend.mockResolvedValue(allDeleted);
      expect(await deleteManyFromR2("my-bucket", keys)).toEqual([]);
      expect(mockSend).toHaveBeenCalledOnce();
      const [command, options] = mockSend.mock.calls[0]!;
      expect(command).toMatchObject({
        batch: true,
        params: {
          Bucket: "my-bucket",
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: false },
        },
      });
      expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
      expect(mockSendClientConfigs[0]).toMatchObject({ maxAttempts: 1 });
    });

    it("passes the caller's signal to the request", async () => {
      const caller = new AbortController();
      let signalled = false;
      mockSend.mockImplementationOnce(async (_command, options) => {
        caller.abort();
        signalled = options.abortSignal.aborted;
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      });
      await expect(
        deleteManyFromR2("my-bucket", keys, { signal: caller.signal })
      ).rejects.toMatchObject({ retryLater: true });
      expect(signalled).toBe(true);
    });

    it("lets a failed request throw so the caller can retry or fall back", async () => {
      mockSend.mockRejectedValue(new Error("network unavailable"));
      await expect(deleteManyFromR2("my-bucket", keys)).rejects.toThrow("network unavailable");
    });

    it("refuses oversized, duplicated or unsafe batches before any request", async () => {
      const tooMany = Array.from({ length: 1001 }, (_, index) => `media/${index}`);
      await expect(deleteManyFromR2("my-bucket", tooMany)).rejects.toThrow();
      await expect(deleteManyFromR2("my-bucket", ["media/a", "media/a"])).rejects.toThrow();
      await expect(deleteManyFromR2("my-bucket", ["media/a", "../private"])).rejects.toThrow();
      expect(await deleteManyFromR2("my-bucket", [])).toEqual([]);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("accepts exactly 1,000 keys in one request", async () => {
      const limit = Array.from({ length: 1000 }, (_, index) => `media/${index}`);
      mockSend.mockResolvedValue({ Deleted: limit.map((Key) => ({ Key })) });
      expect(await deleteManyFromR2("my-bucket", limit)).toEqual([]);
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it("uses one native binding call when the bucket is bound", async () => {
      const remove = vi.fn().mockResolvedValue(undefined);
      (globalThis as Record<string, unknown>).__env__ = {
        PUBLIC_BUCKET: { put: vi.fn(), get: vi.fn(), head: vi.fn(), delete: remove },
      };
      const bucket = process.env.R2_PUBLIC_BUCKET || "verifymzansi-public";
      expect(await deleteManyFromR2(bucket, keys)).toEqual([]);
      expect(remove).toHaveBeenCalledExactlyOnceWith(keys);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("S3 request timeouts", () => {
    it("passes an abortSignal to every S3 send call", async () => {
      mockSend.mockResolvedValue({
        ContentLength: 3,
        Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      });

      await uploadToR2({
        bucket: "b",
        key: "k/a.jpg",
        file: new Blob(["x"]),
        contentType: "image/jpeg",
      });
      await deleteFromR2("b", "k/a.jpg");
      await getR2ObjectSize("b", "k/a.jpg");
      await getR2ObjectBytes("b", "k/a.jpg");
      await uploadKycDocument(new Blob(["doc"]), "seller-1", "id_document");

      expect(mockSend).toHaveBeenCalledTimes(5);
      for (const call of mockSend.mock.calls) {
        expect(call[1]?.abortSignal).toBeInstanceOf(AbortSignal);
      }
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
          head: vi.fn(),
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
          head: vi.fn(),
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
          head: vi.fn(),
        },
      };

      const buffer = await downloadKycDocument("kyc/id_document/seller-1/file.bin");

      expect(get).toHaveBeenCalledTimes(1);
      expect(mockSend).not.toHaveBeenCalled();
      expect(buffer).toEqual(Buffer.from("decrypted-data"));
    });
  });
});
