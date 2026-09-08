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
