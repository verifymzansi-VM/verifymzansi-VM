/**
 * HTTP byte ranges for the media route (RFC 9110, section 14).
 *
 * Phones, and Safari in particular, play and seek a video only when its
 * server answers `Range: bytes=…` with 206 Partial Content. This module only
 * decides what to answer; the route reads the bytes.
 *
 * Choices (each allowed by RFC 9110):
 * - No Range header, a range unit other than `bytes`, or more than one range:
 *   send the whole object (200). A server may ignore any Range header, and
 *   must ignore one whose unit it does not know.
 * - A malformed `bytes` range, a range that starts at or after the end, or an
 *   empty suffix (`bytes=-0`): 416 Range Not Satisfiable.
 * - A range that ends past the object is cut at the last byte.
 */

export type ByteRangeAnswer =
  | { type: "full" }
  | { type: "partial"; start: number; end: number; length: number }
  | { type: "unsatisfiable" };

/** Longer digit strings are beyond any stored object (and exact Numbers). */
const MAX_POSITION_DIGITS = 15;

const SINGLE_BYTE_RANGE = /^(\d*)-(\d*)$/;

function toPosition(digits: string): number {
  const significant = digits.replace(/^0+(?=\d)/, "");
  return significant.length > MAX_POSITION_DIGITS ? Number.POSITIVE_INFINITY : Number(significant);
}

/**
 * Decide how to answer a request's Range header for an object of `size` bytes.
 * The returned `end` is inclusive, as in `Content-Range`.
 */
export function resolveByteRange(header: string | null | undefined, size: number): ByteRangeAnswer {
  const value = header?.trim();
  if (!value) return { type: "full" };

  const equals = value.indexOf("=");
  if (equals < 0 || value.slice(0, equals).trim().toLowerCase() !== "bytes") {
    return { type: "full" };
  }
  const rangeSet = value.slice(equals + 1).trim();
  if (rangeSet.includes(",")) return { type: "full" };

  const match = SINGLE_BYTE_RANGE.exec(rangeSet);
  if (!match) return { type: "unsatisfiable" };
  const [, first, last] = match;
  if (first === "" && last === "") return { type: "unsatisfiable" };
  if (!Number.isSafeInteger(size) || size <= 0) return { type: "unsatisfiable" };

  let start: number;
  let end: number;
  if (first === "") {
    // Suffix range: the last N bytes.
    const suffix = toPosition(last);
    if (suffix === 0) return { type: "unsatisfiable" };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = toPosition(first);
    if (last === "") {
      end = size - 1;
    } else {
      const requestedEnd = toPosition(last);
      if (requestedEnd < start) return { type: "unsatisfiable" };
      end = Math.min(requestedEnd, size - 1);
    }
    if (start >= size) return { type: "unsatisfiable" };
  }

  return { type: "partial", start, end, length: end - start + 1 };
}

/**
 * `If-Range`: the client wants the range only if its copy is still current.
 * With a different (or weak, or date) validator it gets the whole object.
 */
export function rangeStillValid(ifRange: string | null | undefined, etag: string | undefined) {
  const validator = ifRange?.trim();
  if (!validator) return true;
  if (!etag || etag.startsWith("W/")) return false;
  return validator === etag;
}

const PLAYABLE_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/ogg", "video/quicktime"]);

/** True for the video types the media route streams with byte ranges. */
export function isVideoContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return PLAYABLE_VIDEO_TYPES.has(contentType.split(";")[0].trim().toLowerCase());
}
