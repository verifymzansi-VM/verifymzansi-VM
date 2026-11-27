/** Tiny MP4 and WebM files whose headers state a chosen length (tests only). */

function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

/** A box; `large` writes the 64-bit size form (size field 1). */
function box(type: string, payload: number[], large = false): number[] {
  return large
    ? [...u32(1), ...ascii(type), ...u32(0), ...u32(payload.length + 16), ...payload]
    : [...u32(payload.length + 8), ...ascii(type), ...payload];
}

/** mvhd/mdhd: version 0 (32-bit times) or 1 (64-bit times), then timescale and duration. */
function header(
  type: "mvhd" | "mdhd",
  seconds: number,
  timescale: number,
  version: 0 | 1 = 0
): number[] {
  const duration = Math.round(seconds * timescale);
  const times =
    version === 1
      ? [...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(timescale), ...u32(0), ...u32(duration)]
      : [...u32(0), ...u32(0), ...u32(timescale), ...u32(duration)];
  return box(type, [version, 0, 0, 0, ...times, ...new Array(type === "mvhd" ? 80 : 4).fill(0)]);
}

function u16(value: number): number[] {
  return [(value >>> 8) & 255, value & 255];
}

/** An H.264 sample entry: coded size, then `avcC` with one SPS (and PPS) naming a profile and level. */
function videoEntry(video: SyntheticVideoTrack): number[] {
  const profile = video.profile ?? 100;
  const level = video.level ?? 30;
  const sps = [0x67, video.spsProfile ?? profile, 0, level, 0xac, 0xd9];
  const pps = [0x68, 0xeb, 0xe3, 0xcb];
  const avcC = box("avcC", [
    1,
    profile,
    0,
    level,
    0xff,
    0xe1,
    ...u16(sps.length),
    ...sps,
    1,
    ...u16(pps.length),
    ...pps,
  ]);
  return box(video.codec ?? "avc1", [
    ...new Array(6).fill(0),
    ...u16(1),
    ...new Array(16).fill(0),
    ...u16(video.width ?? 640),
    ...u16(video.height ?? 360),
    ...u32(0x480000),
    ...u32(0x480000),
    ...u32(0),
    ...u16(1),
    ...new Array(32).fill(0),
    ...u16(24),
    0xff,
    0xff,
    ...(video.codec === "hvc1" ? box("hvcC", new Array(23).fill(0)) : avcC),
  ]);
}

/** A sound sample entry: AAC-LC, HE-AAC or MP3 in `mp4a`, or Opus. */
function audioEntry(codec: SyntheticAudioCodec): number[] {
  const config =
    codec === "mp3"
      ? [0x6b, 0x15, 0, 0, 0, ...u32(128_000), ...u32(128_000)]
      : [
          0x40,
          0x15,
          0,
          0,
          0,
          ...u32(128_000),
          ...u32(128_000),
          5,
          2,
          codec === "he-aac" ? 0x2b : 0x11,
          0x90,
        ];
  const esds = box("esds", [
    0,
    0,
    0,
    0,
    3,
    config.length + 8,
    0,
    1,
    0,
    4,
    config.length,
    ...config,
    6,
    1,
    2,
  ]);
  return box(codec === "opus" ? "Opus" : "mp4a", [
    ...new Array(6).fill(0),
    ...u16(1),
    ...new Array(8).fill(0),
    ...u16(2),
    ...u16(16),
    ...u32(0),
    ...u32(48_000 * 65_536),
    ...(codec === "opus" ? box("dOps", new Array(11).fill(0)) : esds),
  ]);
}

/** One track whose sample table lasts `seconds` (`fps` frames a second, or 1 s samples). */
function track(
  handler: string,
  seconds: number,
  options: {
    declaredSeconds?: number;
    version?: 0 | 1;
    editSeconds?: number;
    badSizes?: boolean;
    fps?: number;
    entry?: number[];
  }
): number[] {
  const timescale = handler === "vide" ? 30_000 : 48_000;
  const delta = handler === "vide" ? Math.round(30_000 / (options.fps ?? 30)) : 48_000;
  const samples = Math.round((seconds * timescale) / delta);
  const stts = box("stts", [0, 0, 0, 0, ...u32(1), ...u32(samples), ...u32(delta)]);
  const stsz = box("stsz", [
    0,
    0,
    0,
    0,
    ...u32(100),
    ...u32(options.badSizes ? samples + 1 : samples),
  ]);
  const hdlr = box("hdlr", [0, 0, 0, 0, ...u32(0), ...ascii(handler), ...new Array(12).fill(0)]);
  const edts =
    options.editSeconds === undefined
      ? []
      : box(
          "edts",
          box("elst", [
            0,
            0,
            0,
            0,
            ...u32(1),
            ...u32(Math.round(options.editSeconds * 600)),
            ...u32(0),
            0,
            1,
            0,
            0,
          ])
        );
  return box("trak", [
    ...edts,
    ...box("mdia", [
      ...header("mdhd", options.declaredSeconds ?? seconds, timescale, options.version),
      ...hdlr,
      ...box(
        "minf",
        box("stbl", [
          ...(options.entry ? box("stsd", [0, 0, 0, 0, ...u32(1), ...options.entry]) : []),
          ...stts,
          ...stsz,
        ])
      ),
    ]),
  ]);
}

/** The video track's sample description (defaults: `avc1`, 640x360, High profile, level 3.0). */
export type SyntheticVideoTrack = {
  codec?: "avc1" | "avc3" | "hvc1";
  width?: number;
  height?: number;
  profile?: number;
  level?: number;
  /** The profile the SPS inside `avcC` names (defaults to `profile`). */
  spsProfile?: number;
  /** Frames a second (default 30). */
  fps?: number;
};
export type SyntheticAudioCodec = "aac" | "he-aac" | "mp3" | "opus";

export type SyntheticMp4Options = {
  /** The movie header before the media data (default: after it, as phones write it). */
  faststart?: boolean;
  /** The video track's description; `false` writes none (an unreadable description). */
  video?: SyntheticVideoTrack | false;
  /** The audio track's codec (default AAC-LC). */
  audioCodec?: SyntheticAudioCodec;
  /** A second sound track of this length. */
  secondAudioSeconds?: number;
  /** A second video track. */
  secondVideo?: boolean;
  /** A track that is neither video nor sound: subtitles (`text`) or timed metadata (`meta`). */
  extraTrack?: "text" | "meta";
  /** What the movie and media headers declare (players ignore it); defaults to `seconds`. */
  declaredSeconds?: number;
  /** An audio track of this length. */
  audioSeconds?: number;
  /** An edit list on the video track presenting this many seconds. */
  editSeconds?: number;
  /** Version-1 headers and 64-bit box sizes. */
  wide?: boolean;
  /** Fragmented: an `mvex` in the movie and a `moof` after it. */
  fragmented?: boolean;
  /** A sample count in `stsz` that disagrees with `stts`. */
  badSizes?: boolean;
  /** Media data bytes. */
  padding?: number;
  /** A QuickTime `udta/©xyz` location string, as phones write it. */
  location?: string;
};

/**
 * An MP4 with the movie header at the end (as phones write it before
 * "faststart") unless `faststart` is set; its video track's sample table lasts
 * `seconds`.
 */
export function syntheticMp4(seconds: number, options: SyntheticMp4Options = {}): Uint8Array {
  const version: 0 | 1 = options.wide ? 1 : 0;
  const video = options.video === false ? undefined : (options.video ?? {});
  const videoTrack = { ...options, version, fps: video?.fps, entry: video && videoEntry(video) };
  const audio = (audioSeconds: number) =>
    track("soun", audioSeconds, { version, entry: audioEntry(options.audioCodec ?? "aac") });
  const moov = box(
    "moov",
    [
      ...header("mvhd", options.declaredSeconds ?? seconds, 600, version),
      ...track("vide", seconds, videoTrack),
      ...(options.secondVideo ? track("vide", seconds, videoTrack) : []),
      ...(options.audioSeconds === undefined ? [] : audio(options.audioSeconds)),
      ...(options.secondAudioSeconds === undefined ? [] : audio(options.secondAudioSeconds)),
      ...(options.extraTrack === undefined
        ? []
        : track(options.extraTrack, seconds, {
            version,
            entry: box(options.extraTrack === "text" ? "tx3g" : "mebx", new Array(8).fill(0)),
          })),
      ...(options.fragmented ? box("mvex", box("trex", new Array(24).fill(0))) : []),
      ...(options.location === undefined
        ? []
        : box(
            "udta",
            box("©xyz", [0, options.location.length, 0x15, 0xc7, ...ascii(options.location)])
          )),
    ],
    options.wide
  );
  const ftyp = box("ftyp", [...ascii("isom"), ...u32(512)]);
  const fragment = options.fragmented ? box("moof", box("mfhd", new Array(8).fill(0))) : [];
  const padding = options.padding ?? 64;
  const file = new Uint8Array(ftyp.length + 8 + padding + moov.length + fragment.length);
  const mdat = options.faststart ? ftyp.length + moov.length : ftyp.length;
  file.set(ftyp, 0);
  file.set([...u32(padding + 8), ...ascii("mdat")], mdat);
  file.fill(7, mdat + 8, mdat + 8 + padding);
  file.set(moov, options.faststart ? ftyp.length : ftyp.length + 8 + padding);
  file.set(fragment, ftyp.length + 8 + padding + moov.length);
  return file;
}

/** A WebM whose Segment Info states `seconds`, or no Duration at all (as MediaRecorder writes). */
export function syntheticWebm(seconds: number | null): Uint8Array {
  const docType = [0x42, 0x82, 0x84, ...Array.from("webm", (c) => c.charCodeAt(0))];
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x80 | docType.length, ...docType];
  const scale = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]; // 1 ms
  const duration: number[] = [];
  if (seconds !== null) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, seconds * 1000);
    duration.push(0x44, 0x89, 0x88, ...new Uint8Array(view.buffer));
  }
  const info = [
    0x15,
    0x49,
    0xa9,
    0x66,
    0x80 | (scale.length + duration.length),
    ...scale,
    ...duration,
  ];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x81, 0xe7]; // empty timecode-only cluster start
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  return new Uint8Array([...ebml, ...segment, ...info, ...cluster]);
}
