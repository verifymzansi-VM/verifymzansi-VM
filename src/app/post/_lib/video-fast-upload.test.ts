import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockVideoTranscodeError, mockCompressVideoForUpload, mockLogWarn, mockReadLength } =
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
      mockLogWarn: vi.fn(),
      mockReadLength: vi.fn(),
    };
  });

vi.mock("@/lib/media/video-length-client", () => ({
  readVideoLengthSeconds: mockReadLength,
}));

vi.mock("@/lib/media/compress-before-upload", () => ({
  VideoTranscodeError: MockVideoTranscodeError,
  compressVideoForUpload: mockCompressVideoForUpload,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    warn: mockLogWarn,
  }),
}));

const { prewarmVideoForFastUpload, uploadVideoWithFastPath } =
  await import("@/app/post/_lib/video-fast-upload");

describe("uploadVideoWithFastPath", () => {
  // No request leaves the module itself: the retired direct-to-storage
  // routes are never asked for an upload URL.
  const networkFetch = vi.fn();

  it("limits video transfers to two and releases slots after failure", async () => {
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
      const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/saved.mp4");
      const options = { file, area, uploadViaServer };
      await Promise.all([uploadVideoWithFastPath(options), uploadVideoWithFastPath(options)]);
      expect(await uploadVideoWithFastPath(options)).toBe("https://media.example.com/saved.mp4");
      expect(uploadViaServer).toHaveBeenCalledTimes(1);
    }
  );

  it("retries failed uploads without reusing another area's upload", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
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
    expect(networkFetch).not.toHaveBeenCalled();
    expect(uploadViaServer).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", networkFetch);
    mockCompressVideoForUpload.mockImplementation(async (file: File) => file);
    mockReadLength.mockResolvedValue(30);
  });

  it("refuses a 121 s video before converting or uploading it, and accepts 119 s", async () => {
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/ok.mp4");
    mockReadLength.mockResolvedValueOnce(121);
    await expect(
      uploadVideoWithFastPath({
        file: new File(["long"], "long.mp4", { type: "video/mp4" }),
        area: "listing",
        uploadViaServer,
      })
    ).rejects.toThrow("Your video is 2 min 1 s; the limit is 2 minutes.");
    expect(mockCompressVideoForUpload).not.toHaveBeenCalled();
    expect(uploadViaServer).not.toHaveBeenCalled();

    mockReadLength.mockResolvedValueOnce(119);
    await expect(
      uploadVideoWithFastPath({
        file: new File(["ok"], "ok.mp4", { type: "video/mp4" }),
        area: "listing",
        uploadViaServer,
      })
    ).resolves.toBe("https://media.example.com/ok.mp4");
  });

  it("applies the event limit at submit: 61 s refused, 59 s accepted", async () => {
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/event.mp4");
    mockReadLength.mockResolvedValueOnce(61);
    await expect(
      uploadVideoWithFastPath({
        file: new File(["event"], "event.mp4", { type: "video/mp4" }),
        area: "promotion",
        uploadViaServer,
        maxSeconds: 60,
      })
    ).rejects.toThrow("Your video is 1 min 1 s; the limit is 1 minute.");
    mockReadLength.mockResolvedValueOnce(59);
    await expect(
      uploadVideoWithFastPath({
        file: new File(["event"], "event2.mp4", { type: "video/mp4" }),
        area: "promotion",
        uploadViaServer,
        maxSeconds: 60,
      })
    ).resolves.toBe("https://media.example.com/event.mp4");
  });

  it("refuses a video whose length cannot be read even after conversion", async () => {
    const uploadViaServer = vi.fn();
    mockReadLength.mockResolvedValue(null);
    await expect(
      uploadVideoWithFastPath({
        file: new File(["?"], "unknown.webm", { type: "video/webm" }),
        area: "listing",
        uploadViaServer,
      })
    ).rejects.toThrow("We couldn't read this video's length; please export it as MP4");
    expect(uploadViaServer).not.toHaveBeenCalled();
  });

  it("converts a compatible MP4 whose length cannot be read (a phone trailer) and uploads the measured result", async () => {
    const original = new File(["mp4+trailer"], "samsung.mp4", { type: "video/mp4" });
    const converted = new File(["mp4"], "samsung-converted.mp4", { type: "video/mp4" });
    mockCompressVideoForUpload.mockResolvedValueOnce(converted);
    mockReadLength.mockImplementation(async (file: Blob) => (file === original ? null : 40));
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/samsung.mp4");
    await expect(
      uploadVideoWithFastPath({ file: original, area: "listing", uploadViaServer })
    ).resolves.toBe("https://media.example.com/samsung.mp4");
    expect(mockCompressVideoForUpload).toHaveBeenCalledWith(original, {
      requireCompatibleOutput: true,
      forceConversion: true,
    });
    expect(uploadViaServer).toHaveBeenCalledWith(converted);
  });

  it("converts a WebM with no duration (MediaRecorder) and measures the converted MP4", async () => {
    const original = new File(["webm"], "recorded.webm", { type: "video/webm" });
    const converted = new File(["mp4"], "recorded.mp4", { type: "video/mp4" });
    mockCompressVideoForUpload.mockResolvedValueOnce(converted);
    mockReadLength.mockImplementation(async (file: Blob) => (file === original ? null : 45));
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/recorded.mp4");
    await expect(
      uploadVideoWithFastPath({ file: original, area: "listing", uploadViaServer })
    ).resolves.toBe("https://media.example.com/recorded.mp4");
    expect(uploadViaServer).toHaveBeenCalledWith(converted);
  });

  it("refuses a converted WebM over an event's limit", async () => {
    const original = new File(["webm"], "teaser.webm", { type: "video/webm" });
    mockCompressVideoForUpload.mockResolvedValueOnce(
      new File(["mp4"], "teaser.mp4", { type: "video/mp4" })
    );
    mockReadLength.mockImplementation(async (file: Blob) => (file === original ? null : 90));
    const uploadViaServer = vi.fn();
    await expect(
      uploadVideoWithFastPath({
        file: original,
        area: "promotion",
        uploadViaServer,
        maxSeconds: 60,
      })
    ).rejects.toThrow("Your video is 1 min 30 s; the limit is 1 minute.");
    expect(uploadViaServer).not.toHaveBeenCalled();
  });

  it("does not reuse a 2-minute upload when the post switches to an event", async () => {
    const file = new File(["clip"], "tour.mp4", { type: "video/mp4" });
    mockReadLength.mockResolvedValue(90);
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/tour.mp4");
    await expect(
      uploadVideoWithFastPath({ file, area: "promotion", uploadViaServer })
    ).resolves.toBe("https://media.example.com/tour.mp4");
    await expect(
      uploadVideoWithFastPath({ file, area: "promotion", uploadViaServer, maxSeconds: 60 })
    ).rejects.toThrow("Your video is 1 min 30 s; the limit is 1 minute.");
    expect(uploadViaServer).toHaveBeenCalledTimes(1);
  });

  it("refuses a failed conversion without uploading the original", async () => {
    const original = new File(["mov"], "clip.mov", { type: "video/quicktime" });
    mockCompressVideoForUpload.mockRejectedValueOnce(new MockVideoTranscodeError("convert failed"));
    const uploadViaServer = vi.fn();
    await expect(
      uploadVideoWithFastPath({ file: original, area: "listing", uploadViaServer })
    ).rejects.toThrow("convert failed");
    expect(uploadViaServer).not.toHaveBeenCalled();
  });

  it("accepts a phone original over 50 MB for conversion, but not over 300 MB", async () => {
    const large = new File(["large"], "large.mp4", { type: "video/mp4" });
    Object.defineProperty(large, "size", { value: 200 * 1024 * 1024 });
    const converted = new File(["small"], "large.mp4", { type: "video/mp4" });
    mockCompressVideoForUpload.mockResolvedValueOnce(converted);
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/large.mp4");
    await uploadVideoWithFastPath({ file: large, area: "listing", uploadViaServer });
    expect(uploadViaServer).toHaveBeenCalledWith(converted);

    const huge = new File(["huge"], "huge.mp4", { type: "video/mp4" });
    Object.defineProperty(huge, "size", { value: 300 * 1024 * 1024 + 1 });
    await expect(
      uploadVideoWithFastPath({ file: huge, area: "listing", uploadViaServer })
    ).rejects.toThrow("300 MB");
  });

  it("sends a prepared video through the validated server upload only", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/server.mp4");

    const url = await uploadVideoWithFastPath({ file, area: "business_cover", uploadViaServer });

    expect(url).toBe("https://media.example.com/server.mp4");
    expect(mockCompressVideoForUpload).toHaveBeenCalledWith(file, {
      requireCompatibleOutput: true,
    });
    expect(uploadViaServer).toHaveBeenCalledWith(file);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("transcodes non-web video before the server upload", async () => {
    const original = new File(["video"], "clip.mov", { type: "video/quicktime" });
    const converted = new File(["mp4"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/converted.mp4");
    mockCompressVideoForUpload.mockResolvedValueOnce(converted);

    const url = await uploadVideoWithFastPath({
      file: original,
      area: "promotion",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/converted.mp4");
    expect(uploadViaServer).toHaveBeenCalledWith(converted);
  });

  it("reuses a background-prepared video during submit", async () => {
    const original = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const prepared = new File(["prepared"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/prepared.mp4");
    mockCompressVideoForUpload.mockResolvedValueOnce(prepared);

    await prewarmVideoForFastUpload(original);
    const url = await uploadVideoWithFastPath({
      file: original,
      area: "promotion",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/prepared.mp4");
    expect(mockCompressVideoForUpload).toHaveBeenCalledTimes(1);
    expect(uploadViaServer).toHaveBeenCalledWith(prepared);
  });

  it("refuses an empty URL from the server upload so the form can retry", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi
      .fn()
      .mockResolvedValueOnce("")
      .mockResolvedValue("https://media.example.com/retry.mp4");
    await expect(
      uploadVideoWithFastPath({ file, area: "listing", uploadViaServer })
    ).rejects.toThrow("no URL");
    expect(await uploadVideoWithFastPath({ file, area: "listing", uploadViaServer })).toBe(
      "https://media.example.com/retry.mp4"
    );
  });
});
