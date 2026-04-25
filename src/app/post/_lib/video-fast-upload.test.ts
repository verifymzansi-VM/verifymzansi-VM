import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockVideoTranscodeError, mockCompressVideoForUpload, mockFetchWithRetry, mockLogWarn } =
  vi.hoisted(() => {
    class MockVideoTranscodeError extends Error {
      constructor(message = "Video transcode failed") {
        super(message);
        this.name = "VideoTranscodeError";
      }
    }

    return {
      MockVideoTranscodeError,
      mockCompressVideoForUpload: vi.fn(),
      mockFetchWithRetry: vi.fn(),
      mockLogWarn: vi.fn(),
    };
  });

vi.mock("@/lib/media/compress-before-upload", () => ({
  VideoTranscodeError: MockVideoTranscodeError,
  compressVideoForUpload: mockCompressVideoForUpload,
}));

vi.mock("@/lib/utils/fetch-retry", () => ({
  fetchWithRetry: mockFetchWithRetry,
}));

vi.mock("@/lib/utils/csrf", () => ({
  withCsrfHeaders: (headers?: HeadersInit) => headers ?? {},
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    warn: mockLogWarn,
  }),
}));

const { prewarmVideoForFastUpload, uploadVideoWithFastPath } =
  await import("@/app/post/_lib/video-fast-upload");

describe("uploadVideoWithFastPath", () => {
  const putFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", putFetch);
    mockCompressVideoForUpload.mockImplementation(async (file: File) => file);
  });

  it("direct uploads prepared MP4 files for fast playback", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn();
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        uploadUrl: "https://upload.example.com/signed",
        publicUrl: "https://media.example.com/clip.mp4",
      }),
    });
    putFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const url = await uploadVideoWithFastPath({
      file,
      area: "promotion",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/clip.mp4");
    expect(mockCompressVideoForUpload).toHaveBeenCalledWith(file, {
      requireCompatibleOutput: true,
    });
    expect(uploadViaServer).not.toHaveBeenCalled();
    expect(mockFetchWithRetry).toHaveBeenCalledWith(
      "/api/media/upload-url",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(putFetch).toHaveBeenCalledWith(
      "https://upload.example.com/signed",
      expect.objectContaining({
        method: "PUT",
        body: file,
      })
    );
  });

  it("falls back to the validated server upload when direct upload is unavailable", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/server.mp4");
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ code: "direct_media_uploads_disabled" }),
    });

    const url = await uploadVideoWithFastPath({
      file,
      area: "business_cover",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/server.mp4");
    expect(mockCompressVideoForUpload).toHaveBeenCalledWith(file, {
      requireCompatibleOutput: true,
    });
    expect(putFetch).not.toHaveBeenCalled();
    expect(uploadViaServer).toHaveBeenCalledWith(file);
  });

  it("transcodes non-web video before falling back to the server upload", async () => {
    const original = new File(["video"], "clip.mov", { type: "video/quicktime" });
    const converted = new File(["mp4"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/converted.mp4");
    mockCompressVideoForUpload.mockResolvedValueOnce(converted);
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ code: "direct_media_uploads_disabled" }),
    });

    const url = await uploadVideoWithFastPath({
      file: original,
      area: "promotion",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/converted.mp4");
    expect(mockCompressVideoForUpload).toHaveBeenCalledWith(original, {
      requireCompatibleOutput: true,
    });
    expect(uploadViaServer).toHaveBeenCalledWith(converted);
  });

  it("reuses a background-prepared video during submit", async () => {
    const original = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const prepared = new File(["prepared"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn();
    mockCompressVideoForUpload.mockResolvedValueOnce(prepared);
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        uploadUrl: "https://upload.example.com/signed",
        publicUrl: "https://media.example.com/prepared.mp4",
      }),
    });
    putFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await prewarmVideoForFastUpload(original);
    const url = await uploadVideoWithFastPath({
      file: original,
      area: "promotion",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/prepared.mp4");
    expect(mockCompressVideoForUpload).toHaveBeenCalledTimes(1);
    expect(putFetch).toHaveBeenCalledWith(
      "https://upload.example.com/signed",
      expect.objectContaining({
        method: "PUT",
        body: prepared,
      })
    );
  });
});
