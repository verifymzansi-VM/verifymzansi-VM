/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  formatVideoLength,
  formatVideoLimit,
  MAX_EVENT_VIDEO_SECONDS,
  MAX_VIDEO_SECONDS,
  readVideoBlobSeconds,
  readVideoBytesSeconds,
  UNREADABLE_VIDEO_LENGTH_MESSAGE,
  VIDEO_GUIDANCE,
  videoLengthProblem,
  videoLimitSeconds,
} from "./video-length";
import { syntheticMp4, syntheticWebm } from "@/test/synthetic-video";

describe("video length rule (owner decision 11 Nov 2026)", () => {
  it("follows the post's kind: events 1 minute, everything else 2 minutes", () => {
    expect(videoLimitSeconds("event")).toBe(60);
    expect(videoLimitSeconds("other")).toBe(120);
    expect(MAX_EVENT_VIDEO_SECONDS).toBe(60);
    expect(MAX_VIDEO_SECONDS).toBe(120);
  });

  it("accepts 119 s and refuses 121 s for an ordinary post, with the real length", () => {
    expect(videoLengthProblem(119, MAX_VIDEO_SECONDS)).toBeNull();
    expect(videoLengthProblem(121, MAX_VIDEO_SECONDS)).toBe(
      "Your video is 2 min 1 s; the limit is 2 minutes"
    );
  });

  it("accepts 59 s and refuses 61 s for an event", () => {
    expect(videoLengthProblem(59, MAX_EVENT_VIDEO_SECONDS)).toBeNull();
    expect(videoLengthProblem(61, MAX_EVENT_VIDEO_SECONDS)).toBe(
      "Your video is 1 min 1 s; the limit is 1 minute"
    );
  });

  it("allows the phone's rounding: 120.9 s passes, 121.0 s does not", () => {
    expect(videoLengthProblem(120.9, MAX_VIDEO_SECONDS)).toBeNull();
    expect(videoLengthProblem(121.0, MAX_VIDEO_SECONDS)).not.toBeNull();
  });

  it("refuses a video whose length cannot be read", () => {
    for (const seconds of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(videoLengthProblem(seconds, MAX_VIDEO_SECONDS)).toBe(UNREADABLE_VIDEO_LENGTH_MESSAGE);
    }
    expect(UNREADABLE_VIDEO_LENGTH_MESSAGE).toBe(
      "We couldn't read this video's length; please export it as MP4"
    );
  });

  it("writes lengths the way the owner's example does", () => {
    expect(formatVideoLength(160)).toBe("2 min 40 s");
    expect(formatVideoLength(60)).toBe("1 min");
    expect(formatVideoLength(59.7)).toBe("59 s");
    expect(formatVideoLimit(120)).toBe("2 minutes");
    expect(formatVideoLimit(45)).toBe("45 seconds");
    expect(videoLengthProblem(160, 120)).toBe("Your video is 2 min 40 s; the limit is 2 minutes");
  });

  it("keeps the owner-approved seller guidance word for word", () => {
    expect(VIDEO_GUIDANCE).toBe(
      "Up to 2 minutes (events: 1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30 seconds — put the best part first."
    );
  });
});

describe("reading the length from the file", () => {
  it("reads an MP4 whose movie header sits after the media data", async () => {
    expect(await readVideoBytesSeconds(syntheticMp4(119))).toBeCloseTo(119, 3);
    expect(await readVideoBytesSeconds(syntheticMp4(121))).toBeCloseTo(121, 3);
  });

  it("reads the same length through a picked file (Blob)", async () => {
    const blob = new Blob([syntheticMp4(59).slice().buffer]);
    expect(await readVideoBlobSeconds(blob)).toBeCloseTo(59, 3);
  });

  it("uses the longest of the movie and track headers, so a short movie header cannot hide a long track", async () => {
    expect(await readVideoBytesSeconds(syntheticMp4(30, { trackSeconds: 150 }))).toBeCloseTo(
      150,
      3
    );
    expect(
      await readVideoBytesSeconds(syntheticMp4(0, { trackSeconds: 90, withMovieHeader: false }))
    ).toBeCloseTo(90, 3);
  });

  it("reads a WebM's Segment Info duration", async () => {
    expect(await readVideoBytesSeconds(syntheticWebm(61))).toBeCloseTo(61, 3);
  });

  it("returns null for a WebM without a duration and for bytes that are not a video", async () => {
    expect(await readVideoBytesSeconds(syntheticWebm(null))).toBeNull();
    expect(await readVideoBytesSeconds(new Uint8Array(64).fill(9))).toBeNull();
    expect(await readVideoBytesSeconds(new Uint8Array(4))).toBeNull();
    const truncated = syntheticMp4(100).slice(0, 60);
    expect(await readVideoBytesSeconds(truncated)).toBeNull();
  });
});
