/** Tiny MP4 and WebM files whose headers state a chosen length (tests only). */

function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function box(type: string, payload: number[]): number[] {
  return [...u32(payload.length + 8), ...Array.from(type, (c) => c.charCodeAt(0)), ...payload];
}

/** mvhd/mdhd version 0: flags, creation, modification, timescale, duration, then padding. */
function header(type: "mvhd" | "mdhd", seconds: number, timescale = 600): number[] {
  return box(type, [
    0,
    0,
    0,
    0,
    ...u32(0),
    ...u32(0),
    ...u32(timescale),
    ...u32(Math.round(seconds * timescale)),
    ...new Array(type === "mvhd" ? 80 : 4).fill(0),
  ]);
}

/**
 * An MP4 with the movie header at the end (as phones write it before
 * "faststart"). `trackSeconds` sets the video track's own length.
 */
export function syntheticMp4(
  seconds: number,
  options: { trackSeconds?: number; withMovieHeader?: boolean; padding?: number } = {}
): Uint8Array {
  const track = box("trak", box("mdia", header("mdhd", options.trackSeconds ?? seconds, 30_000)));
  const moov = box("moov", [
    ...(options.withMovieHeader === false ? [] : header("mvhd", seconds)),
    ...track,
  ]);
  const ftyp = box("ftyp", [...Array.from("isom", (c) => c.charCodeAt(0)), ...u32(512)]);
  const padding = options.padding ?? 64;
  const file = new Uint8Array(ftyp.length + 8 + padding + moov.length);
  file.set(ftyp, 0);
  file.set([...u32(padding + 8), 0x6d, 0x64, 0x61, 0x74], ftyp.length); // "mdat"
  file.fill(7, ftyp.length + 8, ftyp.length + 8 + padding);
  file.set(moov, ftyp.length + 8 + padding);
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
