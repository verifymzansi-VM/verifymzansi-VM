/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readVideoBlobFacts, readVideoBytesFacts, type VideoFileFacts } from "./video-length";
import {
  MAX_KEPT_VIDEO_BITS_PER_SECOND,
  VIDEO_RULE_MESSAGE,
  videoPreparation,
  videoRuleProblem,
  videoUploadFacts,
  type VideoRuleProblem,
  type VideoSource,
} from "./video-rule";
import { syntheticMp4, type SyntheticMp4Options } from "@/test/synthetic-video";

const FIXTURES = "src/lib/media/__fixtures__/video-rule";

async function factsOf(bytes: Uint8Array): Promise<VideoFileFacts> {
  const facts = await readVideoBytesFacts(bytes);
  if (!facts) throw new Error("facts unreadable");
  return facts;
}

async function problemOf(bytes: Uint8Array): Promise<VideoRuleProblem | null> {
  return videoRuleProblem(await factsOf(bytes), bytes.length);
}

/** A 2 s faststart MP4 with AAC audio; options change one thing at a time. */
function clip(options: SyntheticMp4Options = {}) {
  return syntheticMp4(2, { faststart: true, audioSeconds: 2, ...options });
}

describe("real MP4 files (made with the site's own ffmpeg.wasm; see make-video-rule-fixtures.mjs)", () => {
  const expected: Record<string, VideoRuleProblem | null> = {
    "pass-720x1280-high-30fps-aac.mp4": null,
    "pass-1080x1920-high-30fps-aac.mp4": null,
    "pass-1280x720-main-60fps-silent.mp4": null,
    "pass-converter-baseline-720p.mp4": null,
    "pass-1920x1080-29.97fps-aac.mp4": null,
    "fail-moov-at-end.mp4": "not_faststart",
    "fail-1920x1080-60fps.mp4": "video_fps",
    "fail-2560x1440.mp4": "video_size",
    "fail-high-bitrate.mp4": "bitrate",
    "fail-two-audio-tracks.mp4": "audio_codec",
    "fail-subtitle-track.mp4": "extra_tracks",
    "fail-mp3-audio.mp4": "audio_codec",
  };

  it("has exactly the reviewed fixture set", () => {
    expect(readdirSync(FIXTURES).sort()).toEqual(
      [...Object.keys(expected), "remux-h264-aac.mov", "unreadable-fragmented.mp4"].sort()
    );
  });

  it.each(Object.entries(expected))("%s → %s", async (name, problem) => {
    const bytes = new Uint8Array(readFileSync(`${FIXTURES}/${name}`));
    expect(await problemOf(bytes)).toBe(problem);
  });

  it("reads a fragmented MP4 as unreadable (refused for its length already)", async () => {
    const bytes = new Uint8Array(readFileSync(`${FIXTURES}/unreadable-fragmented.mp4`));
    expect(await readVideoBytesFacts(bytes)).toBeNull();
  });

  it("reads the facts a member's phone and the server both see", async () => {
    const bytes = new Uint8Array(readFileSync(`${FIXTURES}/pass-720x1280-high-30fps-aac.mp4`));
    const facts = await factsOf(bytes);
    expect(facts).toMatchObject({
      faststart: true,
      videoTracks: 1,
      audio: "aac",
      audioTracks: 1,
      otherTracks: 0,
      video: { codec: "avc1", profile: 100, width: 720, height: 1280 },
    });
    expect(facts.video.fps).toBeCloseTo(30, 1);
    expect(facts.video.level).toBeLessThanOrEqual(42);
    expect(await readVideoBlobFacts(new Blob([bytes]))).toEqual(facts);
  });

  it("passes the site's own adverts (real phone-ready MP4s)", async () => {
    for (const name of ["business", "market", "tourism"]) {
      const bytes = new Uint8Array(readFileSync(`public/video/advert-originals/${name}.mp4`));
      expect((await factsOf(bytes)).video.codec).toBe("avc1");
    }
  });
});

describe("the keep rule on described files", () => {
  it("keeps a faststart H.264 file with AAC or no audio", async () => {
    expect(await problemOf(clip())).toBeNull();
    expect(await problemOf(syntheticMp4(2, { faststart: true }))).toBeNull();
    expect(await problemOf(clip({ audioCodec: "he-aac" }))).toBeNull();
    expect(await problemOf(clip({ video: { codec: "avc3" } }))).toBeNull();
    expect(await problemOf(clip({ video: { profile: 66, level: 31 } }))).toBeNull();
    expect(await problemOf(clip({ video: { profile: 77 } }))).toBeNull();
  });

  it("refuses the movie header after the media data", async () => {
    expect(await problemOf(clip({ faststart: false }))).toBe("not_faststart");
  });

  it("refuses HEVC, an unreadable description and two video tracks", async () => {
    expect(await problemOf(clip({ video: { codec: "hvc1" } }))).toBe("video_codec");
    expect(await problemOf(clip({ video: false }))).toBe("video_codec");
    expect(await problemOf(clip({ secondVideo: true }))).toBe("video_codec");
  });

  it.each([110, 122, 244, 88])(
    "refuses profile %i (10-bit, 4:2:2, 4:4:4, Extended)",
    async (profile) => {
      expect(await problemOf(clip({ video: { profile } }))).toBe("video_profile");
    }
  );

  it("refuses an avcC whose SPS names another profile", async () => {
    expect(await problemOf(clip({ video: { profile: 100, spsProfile: 110 } }))).toBe(
      "video_profile"
    );
  });

  it("allows level 4.2 and refuses 5.1", async () => {
    expect(await problemOf(clip({ video: { level: 42 } }))).toBeNull();
    expect(await problemOf(clip({ video: { level: 51 } }))).toBe("video_level");
  });

  it("allows 1080p in either orientation, coded as 1088 too, and refuses larger", async () => {
    expect(await problemOf(clip({ video: { width: 1920, height: 1080 } }))).toBeNull();
    expect(await problemOf(clip({ video: { width: 1080, height: 1920 } }))).toBeNull();
    expect(await problemOf(clip({ video: { width: 1920, height: 1088 } }))).toBeNull();
    expect(await problemOf(clip({ video: { width: 1920, height: 1090 } }))).toBe("video_size");
    expect(await problemOf(clip({ video: { width: 2560, height: 1440 } }))).toBe("video_size");
    expect(await problemOf(clip({ video: { width: 2048, height: 1080 } }))).toBe("video_size");
  });

  it("allows 60 fps only up to a 720-pixel short edge, and 30 fps with tolerance above it", async () => {
    expect(await problemOf(clip({ video: { width: 1280, height: 720, fps: 60 } }))).toBeNull();
    expect(await problemOf(clip({ video: { width: 1280, height: 721, fps: 60 } }))).toBe(
      "video_fps"
    );
    expect(await problemOf(clip({ video: { width: 1920, height: 1080, fps: 29.97 } }))).toBeNull();
    expect(await problemOf(clip({ video: { width: 1920, height: 1080, fps: 50 } }))).toBe(
      "video_fps"
    );
    expect(await problemOf(clip({ video: { width: 640, height: 360, fps: 120 } }))).toBe(
      "video_fps"
    );
  });

  it("refuses MP3 and Opus audio, and a second sound track", async () => {
    expect(await problemOf(clip({ audioCodec: "mp3" }))).toBe("audio_codec");
    expect(await problemOf(clip({ audioCodec: "opus" }))).toBe("audio_codec");
    expect(await problemOf(clip({ secondAudioSeconds: 2 }))).toBe("audio_codec");
  });

  it("refuses subtitle and timed-metadata tracks", async () => {
    expect(await problemOf(clip({ extraTrack: "text" }))).toBe("extra_tracks");
    expect(await problemOf(clip({ extraTrack: "meta" }))).toBe("extra_tracks");
  });

  it("refuses over 4 Mbps (size x 8 / length) and over 50 MB", async () => {
    const facts = await factsOf(clip());
    const atLimit = (MAX_KEPT_VIDEO_BITS_PER_SECOND * facts.seconds) / 8;
    expect(videoRuleProblem(facts, atLimit)).toBeNull();
    expect(videoRuleProblem(facts, atLimit + 1)).toBe("bitrate");
    // LIM-APP-video-keep-size (docs/testing/limits-register.json)
    expect(videoRuleProblem({ ...facts, seconds: 120 }, 52_428_800)).toBeNull();
    expect(videoRuleProblem({ ...facts, seconds: 120 }, 52_428_801)).toBe("file_size");
    expect(await problemOf(clip({ padding: 1_100_000 }))).toBe("bitrate");
  });
});

describe("stored facts", () => {
  it("names the file and the rule it broke, without length or size (already stored)", async () => {
    const facts = await factsOf(clip({ video: { width: 1280, height: 720, fps: 29.97 } }));
    expect(videoUploadFacts(facts, null)).toEqual({
      codec: "avc1",
      profile: 100,
      level: 30,
      width: 1280,
      height: 720,
      fps: 29.97,
      faststart: true,
      audio: "aac",
      problem: null,
    });
    const hevc = await factsOf(clip({ video: { codec: "hvc1" } }));
    expect(videoUploadFacts(hevc, "video_codec")).toEqual({
      codec: "hvc1",
      width: 640,
      height: 360,
      fps: 30,
      faststart: true,
      audio: "aac",
      problem: "video_codec",
    });
  });

  it("keeps crafted values inside the ranges the database accepts, so logging never refuses", async () => {
    const facts = await factsOf(clip());
    const crafted: VideoFileFacts = {
      ...facts,
      video: {
        ...facts.video,
        codec: String.fromCharCode(0, 118, 233, 10),
        width: 65_535,
        height: 40_000,
        fps: 3_010_000,
      },
    };
    const stored = videoUploadFacts(crafted, "video_codec");
    expect(stored).toMatchObject({ codec: "?v??", width: 20_000, height: 20_000, fps: 1000 });
    expect(stored.codec).toMatch(/^[ -~]{1,8}$/);
    expect(JSON.stringify(stored)).not.toMatch(/[^ -~]/);
    expect(videoUploadFacts({ ...facts, video: { ...facts.video, codec: "" } }, null).codec).toBe(
      "?"
    );
  });

  it("tells the member what to do", () => {
    expect(VIDEO_RULE_MESSAGE).toBe(
      "This video can't be stored as it is. Refresh the page and choose it again, or export it as MP4 (H.264, up to 1080p)."
    );
  });
});

describe("videoPreparation (what the phone does before upload, phase 1b)", () => {
  const expected: Record<string, VideoSource> = {
    "pass-720x1280-high-30fps-aac.mp4": "kept",
    "pass-1080x1920-high-30fps-aac.mp4": "kept",
    "pass-1280x720-main-60fps-silent.mp4": "kept",
    "pass-converter-baseline-720p.mp4": "kept",
    "pass-1920x1080-29.97fps-aac.mp4": "kept",
    "fail-moov-at-end.mp4": "remuxed",
    "fail-subtitle-track.mp4": "remuxed",
    "fail-two-audio-tracks.mp4": "remuxed",
    "fail-1920x1080-60fps.mp4": "converted",
    "fail-2560x1440.mp4": "converted",
    "fail-high-bitrate.mp4": "converted",
    "fail-mp3-audio.mp4": "converted",
  };

  it.each(Object.entries(expected))("%s → %s", async (name, source) => {
    const bytes = new Uint8Array(readFileSync(`${FIXTURES}/${name}`));
    expect(videoPreparation(await factsOf(bytes), bytes.length, true)).toBe(source);
  });

  it("reads AAC inside a QuickTime wave box, so a real H.264/AAC MOV is remuxed", async () => {
    const bytes = new Uint8Array(readFileSync(`${FIXTURES}/remux-h264-aac.mov`));
    const facts = await factsOf(bytes);
    expect(facts).toMatchObject({ audio: "aac", audioTracks: 1, faststart: false });
    expect(videoPreparation(facts, bytes.length, false)).toBe("remuxed");
  });

  it("remuxes a file that meets the rule but is not an MP4 (MOV) or a different container", async () => {
    const bytes = new Uint8Array(readFileSync(`${FIXTURES}/pass-720x1280-high-30fps-aac.mp4`));
    expect(videoPreparation(await factsOf(bytes), bytes.length, false)).toBe("remuxed");
  });

  it("converts unreadable headers and anything a copy cannot fix", async () => {
    expect(videoPreparation(null, 1000, true)).toBe("converted");
    const facts = await factsOf(clip());
    // Over 50 MB: a remux keeps the size, so only a conversion can shrink it.
    expect(videoPreparation(facts, 52_428_801, true)).toBe("converted");
    expect(videoPreparation({ ...facts, faststart: false, audio: "other" }, 1000, true)).toBe(
      "converted"
    );
  });

  it("stores how the form prepared the video, and only the three known values", async () => {
    const facts = await factsOf(clip());
    expect(videoUploadFacts(facts, null, "remuxed")).toMatchObject({ source: "remuxed" });
    expect(videoUploadFacts(facts, null)).not.toHaveProperty("source");
    expect(videoUploadFacts(facts, null, "uploaded" as unknown as VideoSource)).not.toHaveProperty(
      "source"
    );
  });
});
