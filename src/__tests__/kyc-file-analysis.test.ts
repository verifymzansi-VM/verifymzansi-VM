import type * as ImageReencodeModule from "@/lib/utils/image-reencode";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockValidateBufferIntegrity,
  mockScanForMalware,
  mockInspectJpegExif,
  mockGetImageDimensions,
  mockDecodeImageToPixels,
  mockComputeLaplacianVariance,
  mockComputePerceptualHash,
  mockReencodeImage,
} = vi.hoisted(() => ({
  mockValidateBufferIntegrity: vi.fn(),
  mockScanForMalware: vi.fn(),
  mockInspectJpegExif: vi.fn(),
  mockGetImageDimensions: vi.fn(),
  mockDecodeImageToPixels: vi.fn(),
  mockComputeLaplacianVariance: vi.fn(),
  mockComputePerceptualHash: vi.fn(),
  mockReencodeImage: vi.fn(),
}));

vi.mock("@/lib/utils/file-validation", () => ({
  validateBufferIntegrity: mockValidateBufferIntegrity,
}));
vi.mock("@/lib/utils/malware-scan", () => ({ scanForMalware: mockScanForMalware }));
vi.mock("@/lib/utils/exif-inspect", () => ({ inspectJpegExif: mockInspectJpegExif }));
vi.mock("@/lib/utils/image-dimensions", () => ({ getImageDimensions: mockGetImageDimensions }));
vi.mock("@/lib/utils/blur-detection", () => ({
  decodeImageToPixels: mockDecodeImageToPixels,
  computeLaplacianVariance: mockComputeLaplacianVariance,
}));
vi.mock("@/lib/utils/perceptual-hash", () => ({
  computePerceptualHash: mockComputePerceptualHash,
}));
vi.mock("@/lib/utils/image-reencode", async (importOriginal) => ({
  ...(await importOriginal<typeof ImageReencodeModule>()),
  reencodeImage: mockReencodeImage,
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { analyzeKycUploadFile } from "@/app/api/verification/upload/_lib/kyc-file-analysis";
import { ImageReencodeError } from "@/lib/utils/image-reencode";

function makeFile(type: string, name = "upload.jpg") {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("analyzeKycUploadFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateBufferIntegrity.mockReturnValue({ valid: true, detectedMime: "image/jpeg" });
    mockScanForMalware.mockReturnValue({ safe: true });
    mockInspectJpegExif.mockReturnValue({ hasExif: true, orientation: 1 });
    mockGetImageDimensions.mockReturnValue({ width: 800, height: 600 });
    mockDecodeImageToPixels.mockResolvedValue({ width: 2, height: 2, data: new Uint8Array(16) });
    mockComputeLaplacianVariance.mockReturnValue(123);
    mockComputePerceptualHash.mockResolvedValue("abcd1234abcd1234");
    mockReencodeImage.mockImplementation(async (buffer: Uint8Array) => buffer);
  });

  it("rejects files whose declared MIME type does not match their bytes", async () => {
    mockValidateBufferIntegrity.mockReturnValue({ valid: false, detectedMime: "application/pdf" });

    const result = await analyzeKycUploadFile({
      file: makeFile("image/jpeg"),
      fileBuffer: Buffer.from([1, 2, 3]),
      requestId: "req-1",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toMatchObject({ requestId: "req-1" });
    }
  });

  it("rejects suspicious files before EXIF or image analysis", async () => {
    mockScanForMalware.mockReturnValue({ safe: false, threat: "zip-polyglot" });

    const result = await analyzeKycUploadFile({
      file: makeFile("image/jpeg"),
      fileBuffer: Buffer.from([1, 2, 3]),
      requestId: "req-2",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    expect(mockInspectJpegExif).not.toHaveBeenCalled();
  });

  it("returns fraud signals from the original and stores the re-encoded JPEG", async () => {
    const fileBuffer = Buffer.from([1, 2, 3]);

    const result = await analyzeKycUploadFile({
      file: makeFile("image/jpeg"),
      fileBuffer,
      requestId: "req-3",
      userId: "user-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exifSignals).toMatchObject({ hasExif: true });
      expect(result.blurScore).toBe(123);
      expect(result.phash).toBe("abcd1234abcd1234");
      expect(result.fileBuffer).toEqual(fileBuffer);
    }
    expect(mockReencodeImage).toHaveBeenCalledWith(fileBuffer, "image/jpeg");
  });

  it("stores the re-encoded WebP (EXIF/XMP, including GPS, dropped)", async () => {
    mockValidateBufferIntegrity.mockReturnValue({ valid: true, detectedMime: "image/webp" });
    const fileBuffer = Buffer.from([1, 2, 3]);
    const stripped = new Uint8Array([9]);
    mockReencodeImage.mockResolvedValue(stripped);

    const result = await analyzeKycUploadFile({
      file: makeFile("image/webp", "selfie.webp"),
      fileBuffer,
      requestId: "req-webp",
      userId: "user-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(new Uint8Array(result.fileBuffer)).toEqual(stripped);
    expect(mockReencodeImage).toHaveBeenCalledWith(fileBuffer, "image/webp");
  });

  it("stores PDFs as uploaded, without re-encoding", async () => {
    mockValidateBufferIntegrity.mockReturnValue({ valid: true, detectedMime: "application/pdf" });
    const fileBuffer = Buffer.from([1, 2, 3]);

    const result = await analyzeKycUploadFile({
      file: makeFile("application/pdf", "id.pdf"),
      fileBuffer,
      requestId: "req-pdf",
      userId: "user-1",
    });

    expect(result.ok).toBe(true);
    expect(mockReencodeImage).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", 503],
    ["undecodable", 400],
  ] as const)("refuses the upload when re-encoding is %s", async (code, status) => {
    mockReencodeImage.mockRejectedValue(new ImageReencodeError(code, "failed"));

    const result = await analyzeKycUploadFile({
      file: makeFile("image/jpeg"),
      fileBuffer: Buffer.from([1, 2, 3]),
      requestId: "req-reencode",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(status);
  });

  it("rejects undersized images", async () => {
    mockGetImageDimensions.mockReturnValue({ width: 100, height: 100 });

    const result = await analyzeKycUploadFile({
      file: makeFile("image/png", "upload.png"),
      fileBuffer: Buffer.from([1, 2, 3]),
      requestId: "req-4",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toMatchObject({
        error: expect.stringContaining("Image is too small"),
      });
    }
  });
});
