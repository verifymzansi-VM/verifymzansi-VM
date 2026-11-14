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

/** One track whose sample table lasts `seconds` (30 frames a second, or 1 s audio samples). */
function track(
  handler: "vide" | "soun",
  seconds: number,
  options: { declaredSeconds?: number; version?: 0 | 1; editSeconds?: number; badSizes?: boolean }
): number[] {
  const timescale = handler === "vide" ? 30_000 : 48_000;
  const delta = handler === "vide" ? 1_000 : 48_000;
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
      ...box("minf", box("stbl", [...stts, ...stsz])),
    ]),
  ]);
}

export type SyntheticMp4Options = {
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
 * "faststart"); its video track's sample table lasts `seconds`.
 */
export function syntheticMp4(seconds: number, options: SyntheticMp4Options = {}): Uint8Array {
  const version = options.wide ? 1 : 0;
  const moov = box(
    "moov",
    [
      ...header("mvhd", options.declaredSeconds ?? seconds, 600, version),
      ...track("vide", seconds, { ...options, version }),
      ...(options.audioSeconds === undefined
        ? []
        : track("soun", options.audioSeconds, { version })),
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
  file.set(ftyp, 0);
  file.set([...u32(padding + 8), ...ascii("mdat")], ftyp.length);
  file.fill(7, ftyp.length + 8, ftyp.length + 8 + padding);
  file.set(moov, ftyp.length + 8 + padding);
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
