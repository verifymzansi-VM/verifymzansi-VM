import { describe, expect, it, vi } from "vitest";
import { compressVideoForUpload, VideoTranscodeError } from "@/lib/media/compress-before-upload";

const compressVideo = vi.fn();

vi.mock("@/lib/media/video-compressor", () => ({
  compressVideo,
}));

describe("compressVideoForUpload", () => {
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
