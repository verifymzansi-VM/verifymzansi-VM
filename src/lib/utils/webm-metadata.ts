/** WebM container metadata removal, using EBML Void elements of the same
 * length. Media blocks, cue offsets and seek positions therefore stay put.
 * https://www.matroska.org/technical/elements.html
 * Malformed/unsupported framing throws before any bytes are changed. */
type Element = { id: number; start: number; data: number; end: number; unknown: boolean };
const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const segmentChildren = new Set([
  0x114d9b74,
  0x1549a966,
  0x1654ae6b,
  CLUSTER,
  0x1c53bb6b,
  0x1941a469,
  0x1043a770,
  0x1254c367,
]);
const remove = new Set([
  0x1254c367, // Tags: includes location, comments and arbitrary private tags
  0x1941a469, // Attachments: may contain EXIF-bearing thumbnails/documents
  0x1043a770, // Chapter labels may disclose location
  0x7ba9, // Segment title
  0x7384,
  0x3c83ab,
  0x3e83bb, // Segment/previous/next filenames
  0x536e, // Track name
  0x4461, // Recording date
  0xbf, // CRC-32: invalid after a child is replaced; optional in WebM
]);
const containers = new Set([0x1549a966, 0x1654ae6b, 0xae]); // Info, Tracks, TrackEntry

export function scrubWebmMetadata(bytes: Uint8Array): number {
  const ranges: [number, number][] = [];
  let examined = 0;
  function element(start: number, limit: number): Element {
    if (++examined > 100_000) throw new Error("WebM contains too many elements");
    function vint(offset: number, id: boolean) {
      const first = bytes[offset];
      if (offset >= limit || !first) throw new Error("Invalid WebM element header");
      let length = 1;
      let marker = 0x80;
      while (!(first & marker)) {
        marker /= 2;
        length++;
      }
      if (length > (id ? 4 : 8) || offset + length > limit)
        throw new Error("Truncated WebM element header");
      let value = BigInt(id ? first : first - marker);
      for (let i = 1; i < length; i++) value = value * BigInt(256) + BigInt(bytes[offset + i]);
      return {
        length,
        value,
        unknown: !id && value === (BigInt(1) << BigInt(length * 7)) - BigInt(1),
      };
    }
    const id = vint(start, true);
    const size = vint(start + id.length, false);
    const data = start + id.length + size.length;
    if (!size.unknown && size.value > BigInt(limit - data))
      throw new Error("WebM element exceeds its container");
    return {
      id: Number(id.value),
      start,
      data,
      end: size.unknown ? limit : data + Number(size.value),
      unknown: size.unknown,
    };
  }
  const header = element(0, bytes.length);
  if (header.id !== EBML || header.unknown) throw new Error("Invalid WebM header");
  let webm = false;
  for (let at = header.data; at < header.end;) {
    const child = element(at, header.end);
    if (child.unknown) throw new Error("Unknown WebM header size");
    if (child.id === 0x4282) {
      if (webm || new TextDecoder().decode(bytes.subarray(child.data, child.end)) !== "webm")
        throw new Error("Unsupported WebM document type");
      webm = true;
    }
    at = child.end;
  }
  if (!webm) throw new Error("Missing WebM document type");
  function walk(start: number, end: number, depth: number, segment: boolean) {
    if (depth > 4) throw new Error("Excessive WebM nesting");
    let at = start;
    while (at < end) {
      const child = element(at, end);
      if (child.unknown && !(segment && child.id === CLUSTER))
        throw new Error("Unsupported unknown WebM element size");
      if (remove.has(child.id)) ranges.push([child.start, child.end]);
      else if (containers.has(child.id)) walk(child.data, child.end, depth + 1, false);
      if (child.unknown) {
        // Streaming recorders may leave a Cluster size unknown. Scan its
        // framed children, never search inside encoded audio/video blocks.
        at = child.data;
        while (at < end) {
          const item = element(at, end);
          if (segmentChildren.has(item.id)) break;
          if (item.unknown) throw new Error("Unsupported streaming WebM child");
          at = item.end;
        }
      } else at = child.end;
    }
  }
  let segments = 0;
  for (let at = header.end; at < bytes.length;) {
    const child = element(at, bytes.length);
    if (child.id === SEGMENT && ++segments === 1) walk(child.data, child.end, 0, true);
    else if (child.id !== 0xec || child.unknown) throw new Error("Invalid WebM root element");
    at = child.end;
  }
  if (!segments) throw new Error("Missing WebM segment");
  for (const [start, end] of ranges) {
    const total = end - start;
    let length = 1;
    while (total - 1 - length >= 2 ** (length * 7) - 1) length++;
    let size = total - 1 - length;
    bytes.fill(0, start, end);
    bytes[start] = 0xec; // Void
    for (let i = length; i >= 1; i--) {
      bytes[start + i] = size % 256;
      size = Math.floor(size / 256);
    }
    bytes[start + 1] |= 2 ** (8 - length);
  }
  return ranges.length;
}
