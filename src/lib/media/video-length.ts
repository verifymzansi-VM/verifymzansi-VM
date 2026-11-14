/**
 * Video length rules (roadmap M4.4, owner decision 11 Nov 2026): every video
 * on the platform is at most 2 minutes; an event post's video at most
 * 1 minute. The limit follows the post's kind, not its area.
 *
 * The length is read from the container itself (MP4/MOV `mvhd`/`mdhd`, WebM
 * Segment Info), so the same rule runs in the browser before upload and on
 * the server at upload. Nothing here decodes the media: a forged header can
 * still lie, which the database check at submit (part B) and the 50 MB cap
 * on the stored file bound.
 */

/** Every video on the platform. */
export const MAX_VIDEO_SECONDS = 120;
/** Event posts. */
export const MAX_EVENT_VIDEO_SECONDS = 60;

/** Owner-approved guidance shown wherever a seller picks a video. */
export const VIDEO_GUIDANCE =
  "Up to 2 minutes (events: 1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30 seconds — put the best part first.";

export const UNREADABLE_VIDEO_LENGTH_MESSAGE =
  "We couldn't read this video's length; please export it as MP4";

/** The limit for a post of this kind. */
export function videoLimitSeconds(kind: "event" | "other"): number {
  return kind === "event" ? MAX_EVENT_VIDEO_SECONDS : MAX_VIDEO_SECONDS;
}

/**
 * Whole seconds decide: a 120.9 s clip is "2 minutes" on the phone that
 * filmed it, so it passes a 120 s limit; 121 s does not. This is the "+1 s
 * rounding" allowance.
 */
function isWithinVideoLimit(seconds: number, limitSeconds: number): boolean {
  return Number.isFinite(seconds) && seconds > 0 && Math.floor(seconds) <= limitSeconds;
}

/** "2 min 40 s", "1 min", "59 s". */
export function formatVideoLength(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (!minutes) return `${rest} s`;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** "2 minutes", "1 minute", "45 seconds". */
export function formatVideoLimit(limitSeconds: number): string {
  if (limitSeconds % 60 === 0) {
    const minutes = limitSeconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${limitSeconds} seconds`;
}

/** The refusal shown to the seller, or null when the length is allowed. */
export function videoLengthProblem(seconds: number | null, limitSeconds: number): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return UNREADABLE_VIDEO_LENGTH_MESSAGE;
  }
  if (isWithinVideoLimit(seconds, limitSeconds)) return null;
  return `Your video is ${formatVideoLength(seconds)}; the limit is ${formatVideoLimit(limitSeconds)}`;
}

/** Reads `length` bytes at `offset` (fewer at the end of the file). */
type VideoByteReader = (offset: number, length: number) => Promise<Uint8Array>;

/** Longest plausible clip; anything longer is treated as a broken header. */
const MAX_PLAUSIBLE_SECONDS = 24 * 60 * 60;
/** A movie header with its sample tables; 2 minutes of phone video needs far less. */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 1024;

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function u64(bytes: Uint8Array, offset: number): number | null {
  const high = u32(bytes, offset);
  const low = u32(bytes, offset + 4);
  if (high > 0x1fffff) return null;
  return high * 2 ** 32 + low;
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

function plausible(seconds: number | null): number | null {
  return seconds !== null &&
    Number.isFinite(seconds) &&
    seconds > 0 &&
    seconds <= MAX_PLAUSIBLE_SECONDS
    ? seconds
    : null;
}

/** Child boxes of [start, end) inside an in-memory `moov`; null when malformed. */
function children(
  bytes: Uint8Array,
  start: number,
  end: number
): Array<{ type: string; data: number; end: number }> | null {
  const found: Array<{ type: string; data: number; end: number }> = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(bytes, offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const large = u64(bytes, offset + 8);
      if (large === null) return null;
      size = large;
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) return null;
    found.push({ type: fourcc(bytes, offset + 4), data: offset + header, end: offset + size });
    offset += size;
  }
  return found;
}

/** Duration in seconds from an `mvhd` or `mdhd` box (both share this layout). */
function headerSeconds(bytes: Uint8Array, data: number, end: number): number | null {
  if (data + 4 > end) return null;
  const version = bytes[data];
  if (version === 1) {
    if (data + 32 > end) return null;
    const timescale = u32(bytes, data + 20);
    const duration = u64(bytes, data + 24);
    // u64 already refuses the all-ones "unknown" value (and anything past 2^53).
    if (!timescale || duration === null) return null;
    return duration / timescale;
  }
  if (data + 20 > end) return null;
  const timescale = u32(bytes, data + 12);
  const duration = u32(bytes, data + 16);
  if (!timescale || duration === 0xffffffff) return null;
  return duration / timescale;
}

/** The movie's length: the longest of the movie header and every track's media header. */
function isobmffMovieSeconds(moov: Uint8Array): number | null {
  const top = children(moov, 0, moov.length);
  if (!top) return null;
  let movie: number | null = null;
  let movieTimescale = 0;
  let longest = 0;
  for (const box of top) {
    if (box.type === "mvhd") {
      movie = headerSeconds(moov, box.data, box.end);
      const version = moov[box.data];
      movieTimescale = u32(moov, box.data + (version === 1 ? 20 : 12));
    } else if (box.type === "trak") {
      const media = children(moov, box.data, box.end)?.find((child) => child.type === "mdia");
      const header = media && children(moov, media.data, media.end)?.find((c) => c.type === "mdhd");
      const seconds = header ? headerSeconds(moov, header.data, header.end) : null;
      if (seconds) longest = Math.max(longest, seconds);
    } else if (box.type === "mvex" && movieTimescale) {
      // Fragmented MP4: the whole length is in the movie extends header.
      const mehd = children(moov, box.data, box.end)?.find((child) => child.type === "mehd");
      if (mehd && mehd.data + 8 <= mehd.end) {
        const fragments =
          moov[mehd.data] === 1 ? u64(moov, mehd.data + 4) : u32(moov, mehd.data + 4);
        if (fragments) longest = Math.max(longest, fragments / movieTimescale);
      }
    }
  }
  return plausible(Math.max(movie ?? 0, longest) || null);
}

async function readIsobmffSeconds(read: VideoByteReader, size: number): Promise<number | null> {
  for (let offset = 0, boxes = 0; offset + 8 <= size && boxes < MAX_TOP_LEVEL_BOXES; boxes++) {
    const head = await read(offset, 16);
    if (head.length < 8) return null;
    let boxSize = u32(head, 0);
    const type = fourcc(head, 4);
    if (!/^[\x20-\x7e]{4}$/.test(type)) return null;
    if (boxSize === 1) {
      if (head.length < 16) return null;
      const large = u64(head, 8);
      if (large === null) return null;
      boxSize = large;
    } else if (boxSize === 0) boxSize = size - offset;
    if (boxSize < 8 || offset + boxSize > size) return null;
    if (type === "moov") {
      if (boxSize > MAX_MOOV_BYTES) return null;
      const moov = await read(offset, boxSize);
      if (moov.length !== boxSize) return null;
      const header = u32(moov, 0) === 1 ? 16 : 8;
      return isobmffMovieSeconds(moov.subarray(header));
    }
    offset += boxSize;
  }
  return null;
}

const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549a966;
const CLUSTER_ID = 0x1f43b675;
const TIMECODE_SCALE_ID = 0x2ad7b1;
const DURATION_ID = 0x4489;
/** WebM keeps Segment Info near the start; never read further for it. */
const WEBM_HEAD_BYTES = 1024 * 1024;

type EbmlElement = { id: number; data: number; end: number; unknown: boolean };

function ebmlElement(bytes: Uint8Array, start: number, limit: number): EbmlElement | null {
  const vint = (offset: number, id: boolean) => {
    const first = bytes[offset];
    if (offset >= limit || !first) return null;
    let length = 1;
    let marker = 0x80;
    while (!(first & marker)) {
      marker >>= 1;
      length++;
    }
    if (length > (id ? 4 : 8) || offset + length > limit) return null;
    let value = id ? first : first & (marker - 1);
    let allOnes = !id && value === marker - 1;
    for (let i = 1; i < length; i++) {
      value = value * 256 + bytes[offset + i];
      if (bytes[offset + i] !== 0xff) allOnes = false;
    }
    return { length, value, unknown: allOnes };
  };
  const id = vint(start, true);
  if (!id) return null;
  const size = vint(start + id.length, false);
  if (!size) return null;
  const data = start + id.length + size.length;
  if (!size.unknown && size.value > limit - data) {
    // Truncated read window: the element continues past what was read.
    return { id: id.value, data, end: limit, unknown: true };
  }
  return {
    id: id.value,
    data,
    end: size.unknown ? limit : data + size.value,
    unknown: size.unknown,
  };
}

/** Segment Info Duration × TimecodeScale, in seconds. */
function webmSeconds(bytes: Uint8Array): number | null {
  const header = ebmlElement(bytes, 0, bytes.length);
  if (!header || header.id !== EBML_ID || header.unknown) return null;
  const segment = ebmlElement(bytes, header.end, bytes.length);
  if (!segment || segment.id !== SEGMENT_ID) return null;
  for (let at = segment.data, examined = 0; at < segment.end && examined < 1000; examined++) {
    const child = ebmlElement(bytes, at, segment.end);
    if (!child || child.id === CLUSTER_ID) return null;
    if (child.id === INFO_ID) {
      if (child.unknown) return null;
      let scale = 1_000_000;
      let duration: number | null = null;
      for (let inner = child.data; inner < child.end;) {
        const field = ebmlElement(bytes, inner, child.end);
        if (!field || field.unknown) return null;
        const length = field.end - field.data;
        const view = new DataView(bytes.buffer, bytes.byteOffset + field.data, length);
        if (field.id === TIMECODE_SCALE_ID && length >= 1 && length <= 6) {
          scale = 0;
          for (let i = 0; i < length; i++) scale = scale * 256 + bytes[field.data + i];
        } else if (field.id === DURATION_ID) {
          duration = length === 4 ? view.getFloat32(0) : length === 8 ? view.getFloat64(0) : null;
        }
        inner = field.end;
      }
      if (!scale || duration === null) return null;
      return plausible((duration * scale) / 1e9);
    }
    if (child.unknown) return null;
    at = child.end;
  }
  return null;
}

/**
 * The video's length in seconds, read from its container (MP4, MOV or WebM),
 * or null when it cannot be read.
 */
async function readVideoSeconds(read: VideoByteReader, size: number): Promise<number | null> {
  try {
    if (size < 8) return null;
    const magic = await read(0, 4);
    if (magic.length === 4 && u32(magic, 0) === EBML_ID) {
      return webmSeconds(await read(0, Math.min(size, WEBM_HEAD_BYTES)));
    }
    return await readIsobmffSeconds(read, size);
  } catch {
    return null;
  }
}

/** Length of an in-memory upload (the server already holds every byte). */
export function readVideoBytesSeconds(bytes: Uint8Array): Promise<number | null> {
  return readVideoSeconds(
    async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
    bytes.length
  );
}

/** Length of a picked file, reading only the headers it needs. */
export function readVideoBlobSeconds(blob: Blob): Promise<number | null> {
  return readVideoSeconds(
    async (offset, length) =>
      new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
    blob.size
  );
}
