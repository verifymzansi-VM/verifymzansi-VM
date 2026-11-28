import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockVideoTranscodeError, mockPrepare, mockLogWarn, mockReadLength } = vi.hoisted(() => {
  class MockVideoTranscodeError extends Error {
    constructor(message = "Video transcode failed") {
      super(message);
      this.name = "VideoTranscodeError";
    }
  }

  return {
    MockVideoTranscodeError,
    mockPrepare: vi.fn(),
    mockLogWarn: vi.fn(),
    mockReadLength: vi.fn(),
  };
});

vi.mock("@/lib/media/video-length-client", () => ({
  readVideoLengthSeconds: mockReadLength,
}));

vi.mock("@/lib/media/compress-before-upload", () => ({
  VideoTranscodeError: MockVideoTranscodeError,
  prepareVideoUpload: mockPrepare,
}));

const mockExtractFrame = vi.hoisted(() => vi.fn());
vi.mock("@/lib/media/video-frame", () => ({ extractVideoFrame: mockExtractFrame }));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    warn: mockLogWarn,
  }),
}));

const {
  isVideoPreparing,
  pendingVideoPreparationCount,
  prepareVideoForCover,
  videoCoverForSubmit,
  prewarmVideoForFastUpload,
  uploadVideoWithFastPath,
} = await import("@/app/post/_lib/video-fast-upload");

/** What the preparation returns for a remuxed or converted output. */
const converted = (file: File) => ({ file, source: "converted" as const });

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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", networkFetch);
    mockPrepare.mockImplementation(async (file: File) => ({ file, source: "kept" }));
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
    expect(mockPrepare).not.toHaveBeenCalled();
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
    const output = new File(["mp4"], "samsung-converted.mp4", { type: "video/mp4" });
    mockPrepare.mockResolvedValueOnce(converted(output));
    mockReadLength.mockImplementation(async (file: Blob) => (file === original ? null : 40));
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/samsung.mp4");
    await expect(
      uploadVideoWithFastPath({ file: original, area: "listing", uploadViaServer })
    ).resolves.toBe("https://media.example.com/samsung.mp4");
    expect(mockPrepare).toHaveBeenCalledWith(original, { onProgress: expect.any(Function) });
    expect(uploadViaServer).toHaveBeenCalledWith(output, expect.any(Function), "converted");
  });

  it("converts a WebM with no duration (MediaRecorder) and measures the converted MP4", async () => {
    const original = new File(["webm"], "recorded.webm", { type: "video/webm" });
    const output = new File(["mp4"], "recorded.mp4", { type: "video/mp4" });
    mockPrepare.mockResolvedValueOnce(converted(output));
    mockReadLength.mockImplementation(async (file: Blob) => (file === original ? null : 45));
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/recorded.mp4");
    await expect(
      uploadVideoWithFastPath({ file: original, area: "listing", uploadViaServer })
    ).resolves.toBe("https://media.example.com/recorded.mp4");
    expect(uploadViaServer).toHaveBeenCalledWith(output, expect.any(Function), "converted");
  });

  it("refuses a converted WebM over an event's limit", async () => {
    const original = new File(["webm"], "teaser.webm", { type: "video/webm" });
    mockPrepare.mockResolvedValueOnce(
      converted(new File(["mp4"], "teaser.mp4", { type: "video/mp4" }))
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
    mockPrepare.mockRejectedValueOnce(new MockVideoTranscodeError("convert failed"));
    const uploadViaServer = vi.fn();
    await expect(
      uploadVideoWithFastPath({ file: original, area: "listing", uploadViaServer })
    ).rejects.toThrow("convert failed");
    expect(uploadViaServer).not.toHaveBeenCalled();
  });

  it("LIM-APP-video-original-size: converts an original of exactly 300 MB, not one byte more", async () => {
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/large.mp4");
    const atLimit = new File(["large"], "at-limit.mp4", { type: "video/mp4" });
    Object.defineProperty(atLimit, "size", { value: 300 * 1024 * 1024 });
    mockPrepare.mockResolvedValueOnce(
      converted(new File(["small"], "at-limit.mp4", { type: "video/mp4" }))
    );
    await uploadVideoWithFastPath({ file: atLimit, area: "listing", uploadViaServer });
    expect(mockPrepare.mock.calls.map(([file]) => file)).toEqual([atLimit]);
    expect(uploadViaServer).toHaveBeenCalledTimes(1);

    const over = new File(["huge"], "over.mp4", { type: "video/mp4" });
    Object.defineProperty(over, "size", { value: 300 * 1024 * 1024 + 1 });
    await expect(
      uploadVideoWithFastPath({ file: over, area: "listing", uploadViaServer })
    ).rejects.toThrow("300 MB");
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(uploadViaServer).toHaveBeenCalledTimes(1);
  });

  it("accepts a phone original over 50 MB for conversion, but not over 300 MB", async () => {
    const large = new File(["large"], "large.mp4", { type: "video/mp4" });
    Object.defineProperty(large, "size", { value: 200 * 1024 * 1024 });
    const output = new File(["small"], "large.mp4", { type: "video/mp4" });
    mockPrepare.mockResolvedValueOnce(converted(output));
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/large.mp4");
    await uploadVideoWithFastPath({ file: large, area: "listing", uploadViaServer });
    expect(uploadViaServer).toHaveBeenCalledWith(output, expect.any(Function), "converted");

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
    expect(mockPrepare).toHaveBeenCalledWith(file, { onProgress: expect.any(Function) });
    // How it was prepared travels with the upload (stored with the video's facts).
    expect(uploadViaServer).toHaveBeenCalledWith(file, expect.any(Function), "kept");
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it("transcodes non-web video before the server upload", async () => {
    const original = new File(["video"], "clip.mov", { type: "video/quicktime" });
    const output = new File(["mp4"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/converted.mp4");
    mockPrepare.mockResolvedValueOnce(converted(output));

    const url = await uploadVideoWithFastPath({
      file: original,
      area: "promotion",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/converted.mp4");
    expect(uploadViaServer).toHaveBeenCalledWith(output, expect.any(Function), "converted");
  });

  it("reuses a background-prepared video during submit", async () => {
    const original = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const prepared = new File(["prepared"], "clip.mp4", { type: "video/mp4" });
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/prepared.mp4");
    mockPrepare.mockResolvedValueOnce(converted(prepared));

    await prewarmVideoForFastUpload(original);
    const url = await uploadVideoWithFastPath({
      file: original,
      area: "promotion",
      uploadViaServer,
    });

    expect(url).toBe("https://media.example.com/prepared.mp4");
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(uploadViaServer).toHaveBeenCalledWith(prepared, expect.any(Function), "converted");
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

describe("video upload progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadLength.mockResolvedValue(30);
  });

  it("reports the conversion started at pick to a later submit, then the upload percent", async () => {
    let reportConversion: ((percent: number) => void) | undefined;
    let finishConversion: (() => void) | undefined;
    mockPrepare.mockImplementationOnce(
      (file: File, options: { onProgress?: (percent: number) => void }) =>
        new Promise((resolve) => {
          reportConversion = options.onProgress;
          finishConversion = () => resolve({ file, source: "kept" });
        })
    );
    const file = new File(["video"], "pick.mp4", { type: "video/mp4" });
    void prewarmVideoForFastUpload(file);
    await vi.waitFor(() => expect(reportConversion).toBeDefined());
    reportConversion?.(40);
    expect(pendingVideoPreparationCount()).toBe(1);

    const progress: Array<{ phase: string; percent: number }> = [];
    const uploadViaServer = vi.fn(async (_file: File, onUploadProgress?: (p: number) => void) => {
      onUploadProgress?.(50);
      onUploadProgress?.(100);
      return "https://media.example.com/pick.mp4";
    });
    const upload = uploadVideoWithFastPath({
      file,
      area: "listing",
      uploadViaServer,
      onProgress: ({ phase, percent }) => progress.push({ phase, percent }),
    });
    await vi.waitFor(() => expect(progress).toContainEqual({ phase: "preparing", percent: 40 }));
    reportConversion?.(75);
    finishConversion?.();

    expect(await upload).toBe("https://media.example.com/pick.mp4");
    expect(progress).toEqual([
      { phase: "preparing", percent: 40 },
      { phase: "preparing", percent: 75 },
      { phase: "uploading", percent: 0 },
      { phase: "uploading", percent: 50 },
      { phase: "uploading", percent: 100 },
    ]);
  });

  it("clears the progress state once a preparation finishes or fails", async () => {
    mockPrepare.mockImplementationOnce(async (file: File) => ({ file, source: "kept" }));
    mockPrepare.mockRejectedValueOnce(new MockVideoTranscodeError("bad video"));
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/ok.mp4");

    await uploadVideoWithFastPath({
      file: new File(["a"], "a.mp4", { type: "video/mp4" }),
      area: "listing",
      uploadViaServer,
      onProgress: () => {},
    });
    await expect(
      uploadVideoWithFastPath({
        file: new File(["b"], "b.mp4", { type: "video/mp4" }),
        area: "listing",
        uploadViaServer,
        onProgress: () => {},
      })
    ).rejects.toThrow("bad video");

    expect(pendingVideoPreparationCount()).toBe(0);
  });
});

describe("prepareVideoForCover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadLength.mockResolvedValue(30);
  });

  it("gives the cover picker the prepared file and its progress, sharing the upload's preparation", async () => {
    const original = new File(["mov"], "cover.mov", { type: "video/quicktime" });
    const output = new File(["mp4"], "cover.mp4", { type: "video/mp4" });
    mockPrepare.mockImplementationOnce(
      async (_file: File, options: { onProgress?: (percent: number) => void }) => {
        options.onProgress?.(60);
        return converted(output);
      }
    );
    const onProgress = vi.fn();
    const forCover = prepareVideoForCover(original, onProgress);
    const uploadViaServer = vi.fn().mockResolvedValue("https://media.example.com/cover.mp4");
    await uploadVideoWithFastPath({ file: original, area: "listing", uploadViaServer });
    await expect(forCover).resolves.toBe(output);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(uploadViaServer).toHaveBeenCalledWith(output, expect.any(Function), "converted");
  });

  it("falls back to the picked file when the preparation fails", async () => {
    const original = new File(["mov"], "broken.mov", { type: "video/quicktime" });
    mockPrepare.mockRejectedValueOnce(new MockVideoTranscodeError("bad video"));
    await expect(prepareVideoForCover(original, () => {})).resolves.toBe(original);
  });
});

describe("videoCoverForSubmit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadLength.mockResolvedValue(30);
  });

  it("keeps a chosen cover, and needs none without a video", async () => {
    const cover = [new File(["jpg"], "cover.jpg", { type: "image/jpeg" })];
    const video = new File(["mp4"], "chosen.mp4", { type: "video/mp4" });
    await expect(videoCoverForSubmit(video, cover)).resolves.toBe(cover);
    await expect(videoCoverForSubmit(undefined, [])).resolves.toEqual([]);
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockExtractFrame).not.toHaveBeenCalled();
  });

  it("waits for a video still being prepared and takes its cover from the prepared file", async () => {
    const original = new File(["mov"], "pending.mov", { type: "video/quicktime" });
    const output = new File(["mp4"], "pending.mp4", { type: "video/mp4" });
    const frame = new File(["jpg"], "pending_poster.jpg", { type: "image/jpeg" });
    let finish: () => void = () => {};
    mockPrepare.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve(converted(output))))
    );
    mockExtractFrame.mockResolvedValueOnce(frame);
    void prewarmVideoForFastUpload(original);
    await vi.waitFor(() => expect(isVideoPreparing(original)).toBe(true));
    const cover = videoCoverForSubmit(original, []);
    finish();
    await expect(cover).resolves.toEqual([frame]);
    expect(mockExtractFrame).toHaveBeenCalledWith(output);
    expect(isVideoPreparing(original)).toBe(false);
  });

  it("gives no cover when no frame can be taken", async () => {
    mockExtractFrame.mockResolvedValueOnce(null);
    await expect(
      videoCoverForSubmit(new File(["mp4"], "blank.mp4", { type: "video/mp4" }), [])
    ).resolves.toEqual([]);
  });
});
