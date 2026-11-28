/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  prepareVideoUpload,
  videoNeedsConversion,
  VideoTranscodeError,
} from "@/lib/media/compress-before-upload";
import { syntheticMp4 } from "@/test/synthetic-video";

const transcodeVideo = vi.fn();
vi.mock("@/lib/media/video-compressor", () => ({ transcodeVideo }));

const FIXTURES = "src/lib/media/__fixtures__/video-rule";

/** A real sample file from the keep-rule fixtures, as the picker hands it over. */
function sample(name: string, type = "video/mp4", as = name): File {
  return new File([readFileSync(`${FIXTURES}/${name}`)], as, { type });
}

describe("prepareVideoUpload (phase 1b: keep, remux or convert)", () => {
  it.each([
    "pass-720x1280-high-30fps-aac.mp4",
    "pass-1080x1920-high-30fps-aac.mp4",
    "pass-1280x720-main-60fps-silent.mp4",
    "pass-1920x1080-29.97fps-aac.mp4",
    "pass-converter-baseline-720p.mp4",
  ])("keeps %s untouched without loading the encoder", async (name) => {
    transcodeVideo.mockClear();
    const file = sample(name);
    await expect(prepareVideoUpload(file)).resolves.toEqual({ file, source: "kept" });
    expect(await videoNeedsConversion(file)).toBe(false);
    expect(transcodeVideo).not.toHaveBeenCalled();
  });

  it.each([
    ["fail-moov-at-end.mp4", "video/mp4"],
    ["fail-subtitle-track.mp4", "video/mp4"],
    ["fail-two-audio-tracks.mp4", "video/mp4"],
    // H.264/AAC in a MOV container (the picker's type), streams within the rule.
    ["pass-720x1280-high-30fps-aac.mp4", "video/quicktime"],
  ])("remuxes %s (%s): streams copied, nothing re-encoded", async (name, type) => {
    const output = sample("pass-720x1280-high-30fps-aac.mp4", "video/mp4", "out.mp4");
    transcodeVideo.mockResolvedValueOnce(output);
    const file = sample(name, type);
    expect(await videoNeedsConversion(file)).toBe(true);
    await expect(prepareVideoUpload(file)).resolves.toEqual({ file: output, source: "remuxed" });
    expect(transcodeVideo).toHaveBeenLastCalledWith(
      file,
      expect.objectContaining({ mode: "remuxed", signal: expect.any(AbortSignal) })
    );
  });

  it.each([
    "fail-1920x1080-60fps.mp4",
    "fail-2560x1440.mp4",
    "fail-high-bitrate.mp4",
    "fail-mp3-audio.mp4",
  ])("converts %s", async (name) => {
    const output = sample("pass-converter-baseline-720p.mp4", "video/mp4", "out.mp4");
    transcodeVideo.mockResolvedValueOnce(output);
    const file = sample(name);
    await expect(prepareVideoUpload(file)).resolves.toEqual({
      file: output,
      source: "converted",
    });
    expect(transcodeVideo).toHaveBeenLastCalledWith(
      file,
      expect.objectContaining({ mode: "converted" })
    );
  });

  it("converts a file whose headers cannot be read (fragmented, WebM)", async () => {
    const output = sample("pass-converter-baseline-720p.mp4", "video/mp4", "out.mp4");
    transcodeVideo.mockResolvedValueOnce(output).mockResolvedValueOnce(output);
    const fragmented = sample("unreadable-fragmented.mp4");
    await expect(prepareVideoUpload(fragmented)).resolves.toMatchObject({ source: "converted" });
    expect(transcodeVideo).toHaveBeenLastCalledWith(
      fragmented,
      expect.objectContaining({ mode: "converted", facts: null })
    );
    const webm = new File(["webm"], "clip.webm", { type: "video/webm" });
    await expect(prepareVideoUpload(webm)).resolves.toMatchObject({ source: "converted" });
  });

  it("does not keep an MP4 whose first bytes say QuickTime (the server would refuse it)", async () => {
    const bytes = new Uint8Array(readFileSync(`${FIXTURES}/pass-720x1280-high-30fps-aac.mp4`));
    bytes.set([0x71, 0x74, 0x20, 0x20], 8); // ftyp major brand "qt  "
    const file = new File([bytes], "clip.mp4", { type: "video/mp4" });
    const output = sample("pass-720x1280-high-30fps-aac.mp4", "video/mp4", "out.mp4");
    transcodeVideo.mockResolvedValueOnce(output);
    await expect(prepareVideoUpload(file)).resolves.toMatchObject({ source: "remuxed" });
  });

  it("falls back to a conversion when the remux fails or its output still breaks the rule", async () => {
    const good = sample("pass-converter-baseline-720p.mp4", "video/mp4", "out.mp4");
    const stillBroken = sample("fail-moov-at-end.mp4", "video/mp4", "out.mp4");
    transcodeVideo.mockResolvedValueOnce(stillBroken).mockResolvedValueOnce(good);
    await expect(prepareVideoUpload(sample("fail-moov-at-end.mp4"))).resolves.toEqual({
      file: good,
      source: "converted",
    });
    transcodeVideo.mockRejectedValueOnce(new Error("muxer failed")).mockResolvedValueOnce(good);
    await expect(prepareVideoUpload(sample("fail-subtitle-track.mp4"))).resolves.toMatchObject({
      source: "converted",
    });
  });

  it("refuses a conversion whose output breaks the rule, with the 50 MB message when too large", async () => {
    transcodeVideo.mockResolvedValueOnce(sample("fail-1920x1080-60fps.mp4", "video/mp4", "o.mp4"));
    await expect(prepareVideoUpload(sample("fail-2560x1440.mp4"))).rejects.toThrow(
      "We couldn't convert this video."
    );
    const big = new File([new Uint8Array(52_428_801)], "big.mp4", { type: "video/mp4" });
    transcodeVideo.mockResolvedValueOnce(big);
    await expect(prepareVideoUpload(sample("fail-2560x1440.mp4"))).rejects.toThrow(
      "larger than 50 MB"
    );
  });

  it("LIM-APP-video-upload-size: uploads a converted video of exactly 50 MB, not one byte more", async () => {
    // A 2-minute header with filler after it (at 50 MB about 3.5 Mbps, within the rule).
    const header = syntheticMp4(120, { faststart: true, audioSeconds: 120 });
    for (const [bytes, accepted] of [
      [50 * 1024 * 1024, true],
      [50 * 1024 * 1024 + 1, false],
    ] as const) {
      const filler = new Uint8Array(bytes - header.length);
      new DataView(filler.buffer).setUint32(0, filler.length);
      filler.set([0x66, 0x72, 0x65, 0x65], 4); // a "free" box
      const output = new File([header.slice().buffer, filler], "out.mp4", { type: "video/mp4" });
      transcodeVideo.mockResolvedValueOnce(output);
      const prepared = prepareVideoUpload(sample("fail-2560x1440.mp4"));
      if (accepted) await expect(prepared).resolves.toMatchObject({ file: output });
      else await expect(prepared).rejects.toThrow("larger than 50 MB");
    }
  });

  it("blocks the upload when the conversion fails; the original is never used", async () => {
    transcodeVideo.mockRejectedValueOnce(new Error("Encoder failed"));
    await expect(prepareVideoUpload(sample("fail-mp3-audio.mp4"))).rejects.toBeInstanceOf(
      VideoTranscodeError
    );
  });

  it("refuses a conversion that runs out of time", async () => {
    vi.useFakeTimers();
    try {
      transcodeVideo.mockImplementationOnce(() => new Promise(() => {}));
      const result = prepareVideoUpload(sample("fail-mp3-audio.mp4"), { timeoutMs: 100 });
      const expectation = expect(result).rejects.toThrow("took too long to convert");
      await vi.advanceTimersByTimeAsync(150);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes encoders and starts each timeout only when its work starts", async () => {
    vi.useFakeTimers();
    try {
      const output = sample("pass-converter-baseline-720p.mp4", "video/mp4", "out.mp4");
      const starts: string[] = [];
      const encode = (file: File) => {
        starts.push(file.name);
        return new Promise((resolve) => setTimeout(() => resolve(output), 80));
      };
      transcodeVideo.mockImplementationOnce(encode).mockImplementationOnce(encode);
      const results = Promise.all([
        prepareVideoUpload(sample("fail-mp3-audio.mp4", "video/mp4", "one.mp4"), {
          timeoutMs: 100,
        }),
        prepareVideoUpload(sample("fail-mp3-audio.mp4", "video/mp4", "two.mp4"), {
          timeoutMs: 100,
        }),
      ]);
      const expectation = expect(results).resolves.toHaveLength(2);
      await vi.advanceTimersByTimeAsync(50);
      expect(starts).toEqual(["one.mp4"]);
      await vi.advanceTimersByTimeAsync(200);
      await expectation;
      expect(starts).toEqual(["one.mp4", "two.mp4"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues the queue after a failed conversion and passes progress through", async () => {
    const output = sample("pass-converter-baseline-720p.mp4", "video/mp4", "out.mp4");
    transcodeVideo.mockRejectedValueOnce(new Error("Encoder failed"));
    transcodeVideo.mockImplementationOnce(async (_file, options) => {
      options.onProgress?.(40);
      return output;
    });
    const onProgress = vi.fn();
    const failed = prepareVideoUpload(sample("fail-mp3-audio.mp4"));
    const next = prepareVideoUpload(sample("fail-mp3-audio.mp4"), { onProgress });
    await expect(failed).rejects.toBeInstanceOf(VideoTranscodeError);
    await expect(next).resolves.toMatchObject({ file: output });
    expect(onProgress).toHaveBeenCalledWith(40);
  });
});
