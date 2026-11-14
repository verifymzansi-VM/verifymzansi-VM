import { describe, expect, it, vi } from "vitest";
import { compressVideoForUpload, VideoTranscodeError } from "@/lib/media/compress-before-upload";

const compressVideo = vi.fn();
const compatibleMp4 = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/media/mp4-compatibility", () => ({ hasCompatibleMp4Tracks: compatibleMp4 }));

vi.mock("@/lib/media/video-compressor", () => ({
  compressVideo,
}));

describe("compressVideoForUpload", () => {
  it("requires conversion of HEVC MP4 instead of uploading the unchanged input", async () => {
    compatibleMp4.mockResolvedValueOnce(false);
    const file = new File(["hevc"], "phone.mp4", { type: "video/mp4" });
    compressVideo.mockResolvedValueOnce({ file, skipped: true });
    await expect(compressVideoForUpload(file)).rejects.toBeInstanceOf(VideoTranscodeError);
    expect(compressVideo).toHaveBeenLastCalledWith(
      file,
      expect.objectContaining({ forceTranscode: true })
    );
  });
  it("allows a phone MOV conversion to finish after the old one-minute deadline", async () => {
    vi.useFakeTimers();
    try {
      const original = new File(["mov"], "phone.mov", { type: "video/quicktime" });
      const converted = new File(["mp4"], "phone.mp4", { type: "video/mp4" });
      compressVideo.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({ file: converted }), 90_000))
      );
      const result = compressVideoForUpload(original, { requireCompatibleOutput: true });
      const expectation = expect(result).resolves.toBe(converted);
      await vi.advanceTimersByTimeAsync(90_001);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes encoders and starts each timeout only when its conversion starts", async () => {
    vi.useFakeTimers();
    try {
      const first = new File(["one"], "one.mov", { type: "video/quicktime" });
      const second = new File(["two"], "two.mov", { type: "video/quicktime" });
      const output = new File(["mp4"], "output.mp4", { type: "video/mp4" });
      const starts: string[] = [];
      const encode = (file: File) => {
        starts.push(file.name);
        return new Promise((resolve) => setTimeout(() => resolve({ file: output }), 80));
      };
      compressVideo.mockImplementationOnce(encode).mockImplementationOnce(encode);
      const results = Promise.all([
        compressVideoForUpload(first, { timeoutMs: 100 }),
        compressVideoForUpload(second, { timeoutMs: 100 }),
      ]);
      const expectation = expect(results).resolves.toEqual([output, output]);
      await vi.advanceTimersByTimeAsync(50);
      expect(starts).toEqual(["one.mov"]);
      await vi.advanceTimersByTimeAsync(120);
      await expectation;
      expect(starts).toEqual(["one.mov", "two.mov"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues the queue after a failed conversion", async () => {
    const file = new File(["mov"], "phone.mov", { type: "video/quicktime" });
    const output = new File(["mp4"], "phone.mp4", { type: "video/mp4" });
    compressVideo.mockRejectedValueOnce(new Error("Encoder failed"));
    compressVideo.mockResolvedValueOnce({ file: output });
    const failed = compressVideoForUpload(file);
    const next = compressVideoForUpload(file);
    await expect(failed).rejects.toThrow("Encoder failed");
    await expect(next).resolves.toBe(output);
  });

  it("rejects any unsupported output container", async () => {
    const file = new File(["video"], "clip.avi", { type: "video/x-msvideo" });
    compressVideo.mockResolvedValueOnce({ file });
    await expect(
      compressVideoForUpload(file, { requireCompatibleOutput: true })
    ).rejects.toBeInstanceOf(VideoTranscodeError);
  });
  it("returns the compressed file from compressor result", async () => {
    const original = new File(["original"], "clip.mp4", { type: "video/mp4" });
    const compressed = new File(["compressed"], "clip-compressed.mp4", { type: "video/mp4" });
    compressVideo.mockResolvedValueOnce({ file: compressed });

    const result = await compressVideoForUpload(original);

    expect(compressVideo).toHaveBeenCalledWith(
      original,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result).toBe(compressed);
  });

  it("returns original file when compressor returns it unchanged", async () => {
    const original = new File(["original"], "clip.mp4", { type: "video/mp4" });
    compressVideo.mockResolvedValueOnce({ file: original });

    const result = await compressVideoForUpload(original);

    expect(result).toBe(original);
  });

  it("throws when quicktime input still resolves to quicktime for required-compatible uploads", async () => {
    const original = new File(["original"], "clip.mov", { type: "video/quicktime" });
    compressVideo.mockResolvedValueOnce({ file: original });

    await expect(
      compressVideoForUpload(original, { requireCompatibleOutput: true })
    ).rejects.toBeInstanceOf(VideoTranscodeError);
  });

  it("returns original web-compatible videos when compression times out", async () => {
    const original = new File(["original"], "clip.mp4", { type: "video/mp4" });
    vi.useFakeTimers();
    compressVideo.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new DOMException("Timed out", "AbortError")), 1);
        })
    );

    const resultPromise = compressVideoForUpload(original, { timeoutMs: 1 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(original);
    vi.useRealTimers();
  });

  it("fails incompatible videos when conversion times out", async () => {
    const original = new File(["original"], "clip.mov", { type: "video/quicktime" });
    vi.useFakeTimers();
    compressVideo.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new DOMException("Timed out", "AbortError")), 1);
        })
    );

    const resultPromise = compressVideoForUpload(original, {
      requireCompatibleOutput: true,
      timeoutMs: 1,
    });
    const expectation = expect(resultPromise).rejects.toBeInstanceOf(VideoTranscodeError);
    await vi.runAllTimersAsync();
    await expectation;
    vi.useRealTimers();
  });
});

describe("M4.4: stored videos are MP4 and a failed conversion never publishes the original", () => {
  it("converts WebM like MOV, so the stored video is MP4", async () => {
    const original = new File(["webm"], "clip.webm", { type: "video/webm" });
    const converted = new File(["mp4"], "clip.mp4", { type: "video/mp4" });
    compressVideo.mockResolvedValueOnce({ file: converted, skipped: false });
    await expect(compressVideoForUpload(original, { requireCompatibleOutput: true })).resolves.toBe(
      converted
    );
    expect(compressVideo).toHaveBeenLastCalledWith(
      original,
      expect.objectContaining({ forceTranscode: true })
    );
  });

  it("refuses a WebM when its conversion fails instead of uploading the WebM", async () => {
    const original = new File(["webm"], "clip.webm", { type: "video/webm" });
    compressVideo.mockResolvedValueOnce({ file: original, skipped: true });
    await expect(
      compressVideoForUpload(original, { requireCompatibleOutput: true })
    ).rejects.toThrow("Film it in 720p or export it as MP4");
  });

  it("forces conversion of a compatible MP4 over 50 MB, and never returns that original", async () => {
    const original = new File(["mp4"], "big.mp4", { type: "video/mp4" });
    Object.defineProperty(original, "size", { value: 50 * 1024 * 1024 + 1 });
    compressVideo.mockResolvedValueOnce({ file: original, skipped: true });
    await expect(
      compressVideoForUpload(original, { requireCompatibleOutput: true })
    ).rejects.toBeInstanceOf(VideoTranscodeError);
    expect(compressVideo).toHaveBeenLastCalledWith(
      original,
      expect.objectContaining({ forceTranscode: true })
    );
  });

  it("refuses any conversion output that is not MP4", async () => {
    const original = new File(["mov"], "clip.mov", { type: "video/quicktime" });
    const webm = new File(["webm"], "clip.webm", { type: "video/webm" });
    compressVideo.mockResolvedValueOnce({ file: webm, skipped: false });
    await expect(
      compressVideoForUpload(original, { requireCompatibleOutput: true })
    ).rejects.toBeInstanceOf(VideoTranscodeError);
  });

  it("gives optional compression about 2 minutes before keeping a compatible MP4", async () => {
    vi.useFakeTimers();
    try {
      const original = new File(["mp4"], "clip.mp4", { type: "video/mp4" });
      const compressed = new File(["small"], "clip.mp4", { type: "video/mp4" });
      compressVideo.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({ file: compressed }), 100_000))
      );
      const result = compressVideoForUpload(original, { requireCompatibleOutput: true });
      const expectation = expect(result).resolves.toBe(compressed);
      await vi.advanceTimersByTimeAsync(100_001);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
