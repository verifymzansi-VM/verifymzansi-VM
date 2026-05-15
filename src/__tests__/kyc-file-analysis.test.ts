import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockValidateBufferIntegrity,
  mockScanForMalware,
  mockInspectJpegExif,
  mockGetImageDimensions,
  mockDecodeImageToPixels,
  mockComputeLaplacianVariance,
  mockComputePerceptualHash,
  mockStripExifFromJpeg,
  mockStripMetadataFromPng,
} = vi.hoisted(() => ({
  mockValidateBufferIntegrity: vi.fn(),
  mockScanForMalware: vi.fn(),
  mockInspectJpegExif: vi.fn(),
  mockGetImageDimensions: vi.fn(),
  mockDecodeImageToPixels: vi.fn(),
  mockComputeLaplacianVariance: vi.fn(),
  mockComputePerceptualHash: vi.fn(),
  mockStripExifFromJpeg: vi.fn(),
  mockStripMetadataFromPng: vi.fn(),
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
vi.mock("@/lib/utils/exif-strip", () => ({
  stripExifFromJpeg: mockStripExifFromJpeg,
  stripMetadataFromPng: mockStripMetadataFromPng,
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { analyzeKycUploadFile } from "@/app/api/verification/upload/_lib/kyc-file-analysis";

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
    mockStripExifFromJpeg.mockImplementation((buffer: Buffer) => buffer);
    mockStripMetadataFromPng.mockImplementation((buffer: Buffer) => buffer);
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

  it("returns fraud signals and strips JPEG metadata for clean image uploads", async () => {
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
    expect(mockStripExifFromJpeg).toHaveBeenCalledWith(fileBuffer);
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
