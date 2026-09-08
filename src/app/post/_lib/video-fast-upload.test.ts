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

  it("limits video transfers to two and releases slots after failure", async () => {
    mockFetchWithRetry.mockResolvedValue({ ok: false, status: 410 });
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const uploadViaServer = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      const index = releases.length;
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      if (index === 0) throw new Error("offline");
      return "https://media.example.com/video.mp4";
    });
    const results = Promise.allSettled(
      [1, 2, 3].map((i) =>
        uploadVideoWithFastPath({
          file: new File(["video"], `${i}.mp4`, { type: "video/mp4" }),
          area: "promotion",
          uploadViaServer,
        })
      )
    );
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[1]();
    releases[2]();
    expect((await results).map((result) => result.status)).toEqual([
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(peak).toBe(2);
  });

  it.each(["listing", "business_cover", "promotion"] as const)(
    "reuses successful and in-flight uploads in %s",
    async (area) => {
      const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
      mockFetchWithRetry.mockResolvedValue({ ok: false, status: 410 });
      const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/saved.mp4");
      const options = { file, area, uploadViaServer };
      await Promise.all([uploadVideoWithFastPath(options), uploadVideoWithFastPath(options)]);
      expect(await uploadVideoWithFastPath(options)).toBe("https://media.example.com/saved.mp4");
      expect(uploadViaServer).toHaveBeenCalledTimes(1);
    }
  );

  it("retries failed uploads without reusing another area's upload", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    mockFetchWithRetry.mockResolvedValue({ ok: false, status: 410 });
    const uploadViaServer = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("https://media.example.com/saved.mp4");
    await expect(
      uploadVideoWithFastPath({ file, area: "listing", uploadViaServer })
    ).rejects.toThrow("offline");
    await uploadVideoWithFastPath({ file, area: "listing", uploadViaServer });
    await uploadVideoWithFastPath({ file, area: "promotion", uploadViaServer });
    expect(uploadViaServer).toHaveBeenCalledTimes(3);
  });

  it("rejects oversized converted output before requesting an upload", async () => {
    const file = new File(["video"], "clip.mov", { type: "video/quicktime" });
    const output = new File(["mp4"], "clip.mp4", { type: "video/mp4" });
    Object.defineProperty(output, "size", { value: 50 * 1024 * 1024 + 1 });
    mockCompressVideoForUpload.mockResolvedValueOnce(output);
    const uploadViaServer = vi.fn();
    await expect(
      uploadVideoWithFastPath({ file, area: "promotion", uploadViaServer })
    ).rejects.toThrow("50 MB");
    expect(mockFetchWithRetry).not.toHaveBeenCalled();
    expect(uploadViaServer).not.toHaveBeenCalled();
  });

  it("reuses a verified upload when the PUT response was lost", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn();
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        uploadUrl: "https://upload.example.com/signed",
        key: "media/clip.mp4",
        publicUrl: "https://media.example.com/clip.mp4",
      }),
    });
    putFetch.mockRejectedValueOnce(new TypeError("Network response lost"));
    mockFetchWithRetry.mockResolvedValueOnce({ ok: true });
    expect(await uploadVideoWithFastPath({ file, area: "listing", uploadViaServer })).toBe(
      "https://media.example.com/clip.mp4"
    );
    expect(uploadViaServer).not.toHaveBeenCalled();
  });

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
        key: "media/promotion/user-1/clip.mp4",
        publicUrl: "https://media.example.com/clip.mp4",
      }),
    });
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
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
    expect(mockFetchWithRetry).toHaveBeenCalledWith(
      "/api/media/upload-complete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          key: "media/promotion/user-1/clip.mp4",
          publicUrl: "https://media.example.com/clip.mp4",
          contentType: "video/mp4",
          size: file.size,
          area: "promotion",
        }),
      })
    );
    expect(putFetch).toHaveBeenCalledWith(
      "https://upload.example.com/signed",
      expect.objectContaining({
        method: "PUT",
        body: file,
        signal: expect.any(AbortSignal),
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

  it("falls back to the validated server upload when direct upload verification fails", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/server.mp4");
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        uploadUrl: "https://upload.example.com/signed",
        key: "media/promotion/user-1/clip.mp4",
        publicUrl: "https://media.example.com/clip.mp4",
      }),
    });
    putFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ code: "uploaded_object_mime_mismatch" }),
    });

    const url = await uploadVideoWithFastPath({
      file,
      area: "promotion",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/server.mp4");
    expect(uploadViaServer).toHaveBeenCalledWith(file);
  });

  it("asks the server to reconcile a failed direct PUT before falling back", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/server.mp4");
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        uploadUrl: "https://upload.example.com/signed",
        key: "media/promotion/user-1/clip.mp4",
        publicUrl: "https://media.example.com/clip.mp4",
      }),
    });
    putFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ code: "uploaded_object_missing" }),
    });

    const url = await uploadVideoWithFastPath({
      file,
      area: "promotion",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/server.mp4");
    expect(mockFetchWithRetry).toHaveBeenLastCalledWith(
      "/api/media/upload-complete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          key: "media/promotion/user-1/clip.mp4",
          publicUrl: "https://media.example.com/clip.mp4",
          contentType: "video/mp4",
          size: file.size,
          area: "promotion",
        }),
      })
    );
    expect(uploadViaServer).toHaveBeenCalledWith(file);
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
        key: "media/promotion/user-1/prepared.mp4",
        publicUrl: "https://media.example.com/prepared.mp4",
      }),
    });
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
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
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("falls back to server upload when direct storage upload times out", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/server.mp4");
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        uploadUrl: "https://upload.example.com/signed",
        key: "media/promotion/user-1/clip.mp4",
        publicUrl: "https://media.example.com/clip.mp4",
      }),
    });
    putFetch.mockRejectedValueOnce(new DOMException("Timed out", "AbortError"));
    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ code: "uploaded_object_missing" }),
    });

    const url = await uploadVideoWithFastPath({
      file,
      area: "promotion",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/server.mp4");
    expect(mockFetchWithRetry).toHaveBeenLastCalledWith(
      "/api/media/upload-complete",
      expect.objectContaining({ method: "POST" })
    );
    expect(uploadViaServer).toHaveBeenCalledWith(file);
  });
});
