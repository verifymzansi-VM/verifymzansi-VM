/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatVideoLength,
  formatVideoLimit,
  MAX_EVENT_VIDEO_SECONDS,
  MAX_VIDEO_SECONDS,
  readVideoBlobSeconds,
  readVideoBytesFacts,
  readVideoBytesSeconds,
  UNREADABLE_VIDEO_LENGTH_MESSAGE,
  VIDEO_GUIDANCE,
  VIDEO_SOUND_OFF_TIP,
  videoLengthProblem,
  videoLimitSeconds,
} from "./video-length";
import { syntheticMp4, syntheticWebm } from "@/test/synthetic-video";

describe("video length rule (owner decision 11 Nov 2026)", () => {
  // LIM-APP-video-length and LIM-APP-event-video-length (docs/testing/limits-register.json)
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

  it("tells sellers to put key details on screen, because many watch without sound", () => {
    expect(VIDEO_SOUND_OFF_TIP).toBe(
      "Many people watch without sound: show key details (price, place, phone number) on screen in the video itself."
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

  it("measures the video track's samples, not the declared headers, so a forged header cannot hide a long clip", async () => {
    expect(await readVideoBytesSeconds(syntheticMp4(150, { declaredSeconds: 30 }))).toBeCloseTo(
      150,
      3
    );
    expect(await readVideoBytesSeconds(syntheticMp4(30, { declaredSeconds: 150 }))).toBeCloseTo(
      30,
      3
    );
  });

  it("refuses a sample table whose counts disagree", async () => {
    expect(await readVideoBytesSeconds(syntheticMp4(30, { badSizes: true }))).toBeNull();
  });

  it("refuses fragmented movies, whose length is spread over fragments", async () => {
    expect(await readVideoBytesSeconds(syntheticMp4(30, { fragmented: true }))).toBeNull();
  });

  it("reads version-1 headers and 64-bit box sizes", async () => {
    expect(await readVideoBytesSeconds(syntheticMp4(61, { wide: true }))).toBeCloseTo(61, 3);
  });

  it("counts an edit list that presents the video for longer", async () => {
    expect(await readVideoBytesSeconds(syntheticMp4(30, { editSeconds: 200 }))).toBeCloseTo(200, 2);
  });

  it("ignores audio priming but not a long audio track behind the video", async () => {
    const primed = await readVideoBytesSeconds(syntheticMp4(120.5, { audioSeconds: 121 }));
    expect(primed).toBeCloseTo(120.5, 3);
    expect(videoLengthProblem(primed, MAX_VIDEO_SECONDS)).toBeNull();
    expect(await readVideoBytesSeconds(syntheticMp4(10, { audioSeconds: 600 }))).toBeCloseTo(
      600,
      3
    );
  });

  it.each(["business", "market", "tourism"])(
    "reads the site's own %s advert (a real MP4) as its 4.5 s, matching its movie header",
    async (name) => {
      const bytes = new Uint8Array(readFileSync(`public/video/advert-originals/${name}.mp4`));
      expect(await readVideoBytesSeconds(bytes)).toBeCloseTo(4.5, 2);
    }
  );

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

/** A box around already-built parts, written straight into one buffer (big crafted files). */
function rawBox(type: string, parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(
    Array.from(type, (c) => c.charCodeAt(0)),
    4
  );
  let at = 8;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `count` empty 8-byte `free` boxes back to back, after an optional prefix. */
function tinyBoxes(count: number, prefix: number[] = []): Uint8Array {
  const out = new Uint8Array(prefix.length + count * 8);
  out.set(prefix, 0);
  const view = new DataView(out.buffer);
  for (let i = 0, at = prefix.length; i < count; i++, at += 8) {
    view.setUint32(at, 8);
    view.setUint32(at + 4, 0x66726565); // "free"
  }
  return out;
}

/** A faststart MP4 whose `moov` is `ftyp`, then `moov`, then a little media data. */
function faststartFile(moov: Uint8Array): Uint8Array {
  const ftyp = rawBox("ftyp", [new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0])]);
  const mdat = rawBox("mdat", [new Uint8Array(64)]);
  const file = new Uint8Array(ftyp.length + moov.length + mdat.length);
  file.set(ftyp, 0);
  file.set(moov, ftyp.length);
  file.set(mdat, ftyp.length + moov.length);
  return file;
}

/** The video track of a real synthetic file, with its `stsd` swapped for `stsd`. */
function trackWithStsd(stsd: Uint8Array): Uint8Array {
  const u32 = (value: number) => {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value);
    return out;
  };
  const full = (type: string, payload: number[]) =>
    rawBox(type, [new Uint8Array([0, 0, 0, 0, ...payload])]);
  const mdhd = full("mdhd", [...u32(0), ...u32(0), ...u32(30_000), ...u32(300_000), 0, 0, 0, 0]);
  const hdlr = full("hdlr", [...u32(0), 0x76, 0x69, 0x64, 0x65, ...new Array(12).fill(0)]);
  const stts = full("stts", [...u32(1), ...u32(300), ...u32(1000)]);
  const stsz = full("stsz", [...u32(100), ...u32(300)]);
  return rawBox("trak", [
    rawBox("mdia", [mdhd, hdlr, rawBox("minf", [rawBox("stbl", [stsd, stts, stsz])])]),
  ]);
}

function mvhd(): Uint8Array {
  const payload = new Uint8Array(4 + 16 + 80);
  const view = new DataView(payload.buffer);
  view.setUint32(12, 600);
  view.setUint32(16, 6000);
  return rawBox("mvhd", [payload]);
}

describe("crafted files stay cheap to read (a Worker has 128 MB and little CPU)", () => {
  const MILLIONS = 4_000_000;

  it("ignores an stsd claiming millions of sample entries without collecting them", async () => {
    // 4 million 8-byte entries with the count field set to match: about 32 MB.
    const stsd = rawBox("stsd", [tinyBoxes(MILLIONS, [0, 0, 0, 0, 0x00, 0x3d, 0x09, 0x00])]);
    const file = faststartFile(rawBox("moov", [mvhd(), trackWithStsd(stsd)]));
    const started = performance.now();
    // The track still has a length; its description is unreadable, so the rule refuses it.
    expect((await readVideoBytesFacts(file))?.video.codec).toBe("unknown");
    expect(await readVideoBytesSeconds(file)).toBeCloseTo(10, 3);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("ignores an stsd claiming more sample entries than a real file has", async () => {
    const stsd = rawBox("stsd", [tinyBoxes(17, [0, 0, 0, 0, 0, 0, 0, 17])]);
    const file = faststartFile(rawBox("moov", [mvhd(), trackWithStsd(stsd)]));
    expect((await readVideoBytesFacts(file))?.video.codec).toBe("unknown");
  });

  it("stops collecting boxes inside the movie after a bounded number (millions of tiny boxes)", async () => {
    const file = faststartFile(rawBox("moov", [mvhd(), tinyBoxes(MILLIONS)]));
    const started = performance.now();
    expect(await readVideoBytesSeconds(file)).toBeNull();
    expect(await readVideoBytesFacts(file)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("still reads a movie with a few thousand small boxes beside its track", async () => {
    const stsd = rawBox("stsd", [new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0])]);
    const file = faststartFile(rawBox("moov", [mvhd(), trackWithStsd(stsd), tinyBoxes(5000)]));
    expect(await readVideoBytesSeconds(file)).toBeCloseTo(10, 3);
  });
});
