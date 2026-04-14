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

    expect(compressVideo).toHaveBeenCalledWith(original);
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
});
