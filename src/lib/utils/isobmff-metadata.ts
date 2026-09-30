/**
 * In-place metadata scrubbing for ISO Base Media File Format files
 * (MP4/MOV video, AVIF images) — POPIA: uploaded media must not leak GPS.
 *
 * Unlike the JPEG/PNG/WebP strippers in exif-strip.ts, nothing is removed:
 * the location / Exif VALUE bytes are overwritten with zeros at the same
 * length. Box sizes and every absolute file offset (stco/co64 chunk offsets,
 * iloc extents) therefore stay valid, so the media still plays/decodes and no
 * table needs rewriting.
 *
 * Parsing is defensive: every read is bounds-checked, 64-bit sizes
 * (size == 1) and "extends to end of parent" (size == 0) are handled, nesting
 * depth is capped, and malformed input never throws — walking simply stops at
 * the first box that does not fit, leaving the remaining bytes untouched
 * (anything scrubbed before that point stays scrubbed).
 */

interface Box {
  type: string;
  /** Offset of the box header. */
  start: number;
  /** Offset of the first payload byte (after size/type/largesize). */
  payloadStart: number;
  /** Exclusive end of the box. */
  end: number;
}

type ByteRange = [start: number, end: number];

const MAX_DEPTH = 12;

function readU16(buf: Uint8Array, off: number): number {
  return (buf[off] << 8) | buf[off + 1];
}

function readU32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

/** Read an unsigned big-endian integer of 0, 4 or 8 bytes; null if unrepresentable. */
function readUintN(buf: Uint8Array, off: number, size: number): number | null {
  if (size === 0) return 0;
  if (size === 4) return readU32(buf, off);
  if (size === 8) {
    const hi = readU32(buf, off);
    const lo = readU32(buf, off + 4);
    // Anything past 2^53 cannot be an offset into an in-memory upload.
    if (hi > 0x1fffff) return null;
    return hi * 0x1_0000_0000 + lo;
  }
  return null;
}

function readType(buf: Uint8Array, off: number): string {
  return String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
}

/** Parse the child boxes of [start, end). Stops at the first malformed box. */
function readBoxes(buf: Uint8Array, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  const limit = Math.min(end, buf.length);
  let off = start;
  while (off + 8 <= limit) {
    const size32 = readU32(buf, off);
    const type = readType(buf, off + 4);
    let headerSize = 8;
    let size: number;
    if (size32 === 1) {
      if (off + 16 > limit) break;
      const large = readUintN(buf, off + 8, 8);
      if (large === null) break;
      size = large;
      headerSize = 16;
    } else if (size32 === 0) {
      size = limit - off; // box extends to the end of its parent / the file
    } else {
      size = size32;
    }
    if (type === "uuid") headerSize += 16;
    if (size < headerSize || off + size > limit) break;
    boxes.push({ type, start: off, payloadStart: off + headerSize, end: off + size });
    off += size;
  }
  return boxes;
}

function zeroRanges(buf: Uint8Array, ranges: ByteRange[]): number {
  let count = 0;
  for (const [start, end] of ranges) {
    const s = Math.max(0, start);
    const e = Math.min(buf.length, end);
    if (e > s) {
      buf.fill(0, s, e);
      count += 1;
    }
  }
  return count;
}

// ── Video (MP4 / MOV) location metadata ─────────────────────────────────────

/** QuickTime/iTunes "©xyz" (ISO 6709 location string). */
const XYZ_TYPE = "©xyz";

/** Apple mdta keys that carry location. Match by prefix to cover
 * ISO6709, accuracy.horizontal, name, body, note, role, date, etc. */
const APPLE_LOCATION_KEY_PREFIX = "com.apple.quicktime.location.";

/** Containers that may (transitively) hold user data / metadata. */
const VIDEO_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "udta", "edts"]);

/**
 * `meta` is a FullBox (4 bytes version/flags) in ISO BMFF but a plain
 * container in QuickTime (Apple mdta metadata). Distinguish by looking for a
 * plausible child header right after the box header.
 */
function metaChildrenStart(buf: Uint8Array, meta: Box): number {
  const p = meta.payloadStart;
  if (p + 8 <= meta.end) {
    const firstType = readType(buf, p + 4);
    if (firstType === "hdlr" || firstType === "keys" || firstType === "ilst") return p;
  }
  return p + 4;
}

/** Value byte ranges of the `data` atoms inside an ilst item. */
function dataAtomValueRanges(buf: Uint8Array, item: Box): ByteRange[] {
  const ranges: ByteRange[] = [];
  for (const child of readBoxes(buf, item.payloadStart, item.end)) {
    // data atom payload: type indicator (4) + locale (4) + value
    if (child.type === "data" && child.payloadStart + 8 <= child.end) {
      ranges.push([child.payloadStart + 8, child.end]);
    }
  }
  return ranges;
}

/** Value ranges for a udta `©xyz` box (QuickTime string or iTunes data atom). */
function xyzValueRanges(buf: Uint8Array, box: Box): ByteRange[] {
  const dataRanges = dataAtomValueRanges(buf, box);
  if (dataRanges.length > 0) return dataRanges;
  // QuickTime user-data text: u16 string length + u16 language + string.
  // Keep the 4-byte prefix so the atom stays well-formed; blank the string.
  if (box.payloadStart + 4 <= box.end) return [[box.payloadStart + 4, box.end]];
  return [];
}

/** 3GPP `loci` (FullBox): blank everything after version/flags. */
function lociValueRanges(box: Box): ByteRange[] {
  return box.payloadStart + 4 < box.end ? [[box.payloadStart + 4, box.end]] : [];
}

/** Parse an Apple `keys` box → 1-based key indexes whose name is a location key. */
function appleLocationKeyIndexes(buf: Uint8Array, keys: Box): Set<number> {
  const found = new Set<number>();
  const p = keys.payloadStart + 4; // skip version/flags
  if (p + 4 > keys.end) return found;
  const entryCount = readU32(buf, p);
  let off = p + 4;
  for (let index = 1; index <= entryCount && off + 8 <= keys.end; index += 1) {
    const keySize = readU32(buf, off);
    if (keySize < 8 || off + keySize > keys.end) break;
    const nameStart = off + 8;
    const nameLength = keySize - 8;
    if (nameLength >= APPLE_LOCATION_KEY_PREFIX.length) {
      let prefix = "";
      for (let i = 0; i < APPLE_LOCATION_KEY_PREFIX.length; i += 1) {
        prefix += String.fromCharCode(buf[nameStart + i]);
      }
      if (prefix === APPLE_LOCATION_KEY_PREFIX) found.add(index);
    }
    off += keySize;
  }
  return found;
}

function collectMetaLocationRanges(buf: Uint8Array, meta: Box, depth: number): ByteRange[] {
  const ranges: ByteRange[] = [];
  const children = readBoxes(buf, metaChildrenStart(buf, meta), meta.end);
  const keys = children.find((child) => child.type === "keys");
  const locationKeys = keys ? appleLocationKeyIndexes(buf, keys) : new Set<number>();

  for (const child of children) {
    if (child.type === "ilst") {
      for (const item of readBoxes(buf, child.payloadStart, child.end)) {
        // mdta-style ilst items are typed by their 1-based key index.
        const keyIndex = readU32(buf, item.start + 4);
        if (locationKeys.has(keyIndex) || item.type === XYZ_TYPE) {
          ranges.push(...dataAtomValueRanges(buf, item));
        }
      }
    } else if (depth < MAX_DEPTH) {
      ranges.push(...collectVideoLocationRanges(buf, [child], depth + 1));
    }
  }
  return ranges;
}

function collectVideoLocationRanges(buf: Uint8Array, boxes: Box[], depth: number): ByteRange[] {
  const ranges: ByteRange[] = [];
  for (const box of boxes) {
    if (box.type === XYZ_TYPE) {
      ranges.push(...xyzValueRanges(buf, box));
    } else if (box.type === "loci") {
      ranges.push(...lociValueRanges(box));
    } else if (box.type === "meta") {
      ranges.push(...collectMetaLocationRanges(buf, box, depth));
    } else if (VIDEO_CONTAINERS.has(box.type) && depth < MAX_DEPTH) {
      ranges.push(
        ...collectVideoLocationRanges(buf, readBoxes(buf, box.payloadStart, box.end), depth + 1)
      );
    }
  }
  return ranges;
}

/**
 * Blank GPS/location metadata in an MP4/MOV buffer, IN PLACE.
 *
 * Covers the places phones write the recording location:
 * - `udta/©xyz` (Android MediaMuxer, QuickTime) — ISO 6709 string
 * - Apple `meta` (hdlr mdta) `keys` + `ilst`: values of every
 *   `com.apple.quicktime.location.*` key (ISO6709, accuracy, name, …)
 * - iTunes-style `udta/meta/ilst/©xyz` data atoms
 * - 3GPP `udta/loci`
 *
 * Not covered: per-frame timed-metadata tracks (Apple `mebx` samples in
 * `mdat`), which would need sample-table parsing.
 *
 * @returns the number of value ranges blanked (0 → buffer untouched).
 */
export function scrubVideoLocationMetadata(buffer: Uint8Array): number {
  try {
    if (buffer.length < 8) return 0;
    const top = readBoxes(buffer, 0, buffer.length);
    return zeroRanges(buffer, collectVideoLocationRanges(buffer, top, 0));
  } catch {
    // Defensive: parsing is bounds-checked, but never fail an upload here.
    return 0;
  }
}

// ── AVIF Exif / XMP items ───────────────────────────────────────────────────

interface IlocExtent {
  offset: number;
  length: number;
}

interface IlocItem {
  constructionMethod: number;
  dataReferenceIndex: number;
  extents: IlocExtent[];
}

/** Parse `iinf` → item IDs that hold Exif (or XMP via `mime` rdf+xml). */
function metadataItemIds(buf: Uint8Array, iinf: Box): { exif: Set<number>; xmp: Set<number> } {
  const exif = new Set<number>();
  const xmp = new Set<number>();
  const version = buf[iinf.payloadStart];
  const countSize = version === 0 ? 2 : 4;
  const childrenStart = iinf.payloadStart + 4 + countSize;
  if (childrenStart > iinf.end) return { exif, xmp };

  for (const infe of readBoxes(buf, childrenStart, iinf.end)) {
    if (infe.type !== "infe") continue;
    const p = infe.payloadStart;
    const infeVersion = buf[p];
    if (infeVersion < 2) continue; // v0/v1 carry no item_type; not used for Exif
    const idSize = infeVersion === 2 ? 2 : 4;
    const typeOff = p + 4 + idSize + 2; // + item_protection_index
    if (typeOff + 4 > infe.end) continue;
    const itemId = idSize === 2 ? readU16(buf, p + 4) : readU32(buf, p + 4);
    const itemType = readType(buf, typeOff);
    if (itemType === "Exif") {
      exif.add(itemId);
    } else if (itemType === "mime") {
      // item_name\0 content_type\0 …
      let off = typeOff + 4;
      while (off < infe.end && buf[off] !== 0) off += 1;
      off += 1;
      let contentType = "";
      while (off < infe.end && buf[off] !== 0 && contentType.length < 64) {
        contentType += String.fromCharCode(buf[off]);
        off += 1;
      }
      if (contentType.trim().toLowerCase() === "application/rdf+xml") xmp.add(itemId);
    }
  }
  return { exif, xmp };
}

/** Parse `iloc` (versions 0, 1, 2) into item → extents. Returns what parsed cleanly. */
function parseIloc(buf: Uint8Array, iloc: Box): Map<number, IlocItem> {
  const items = new Map<number, IlocItem>();
  const end = iloc.end;
  let off = iloc.payloadStart;
  if (off + 6 > end) return items;
  const version = buf[off];
  if (version > 2) return items;
  off += 4;
  const offsetSize = buf[off] >> 4;
  const lengthSize = buf[off] & 0x0f;
  const baseOffsetSize = buf[off + 1] >> 4;
  const indexSize = version === 1 || version === 2 ? buf[off + 1] & 0x0f : 0;
  off += 2;
  const validSize = (n: number) => n === 0 || n === 4 || n === 8;
  if (![offsetSize, lengthSize, baseOffsetSize, indexSize].every(validSize)) return items;

  let itemCount: number;
  if (version < 2) {
    if (off + 2 > end) return items;
    itemCount = readU16(buf, off);
    off += 2;
  } else {
    if (off + 4 > end) return items;
    itemCount = readU32(buf, off);
    off += 4;
  }

  for (let i = 0; i < itemCount; i += 1) {
    const idSize = version < 2 ? 2 : 4;
    const headerNeeded = idSize + (version >= 1 ? 2 : 0) + 2 + baseOffsetSize + 2;
    if (off + headerNeeded > end) break;
    const itemId = idSize === 2 ? readU16(buf, off) : readU32(buf, off);
    off += idSize;
    let constructionMethod = 0;
    if (version >= 1) {
      constructionMethod = readU16(buf, off) & 0x0f;
      off += 2;
    }
    const dataReferenceIndex = readU16(buf, off);
    off += 2;
    const baseOffset = readUintN(buf, off, baseOffsetSize);
    off += baseOffsetSize;
    const extentCount = readU16(buf, off);
    off += 2;
    if (baseOffset === null) break;

    const extents: IlocExtent[] = [];
    const extentSize = indexSize + offsetSize + lengthSize;
    if (off + extentSize * extentCount > end) break;
    for (let e = 0; e < extentCount; e += 1) {
      off += indexSize; // extent_index (only meaningful for construction_method 2)
      const extentOffset = readUintN(buf, off, offsetSize);
      off += offsetSize;
      const extentLength = readUintN(buf, off, lengthSize);
      off += lengthSize;
      if (extentOffset === null || extentLength === null) continue;
      extents.push({ offset: baseOffset + extentOffset, length: extentLength });
    }
    items.set(itemId, { constructionMethod, dataReferenceIndex, extents });
  }
  return items;
}

/**
 * Zero the Exif (and XMP) item payloads of an AVIF/HEIF-style image, IN
 * PLACE. Walks the top-level `meta` → `iinf`/`infe` to find items of type
 * `Exif` (and `mime` items with content type application/rdf+xml), resolves
 * their byte ranges through `iloc`, and zeros them. For Exif the leading
 * 4-byte `exif_tiff_header_offset` is kept; the TIFF payload (including all
 * GPS IFDs) is zeroed, so readers find no tags.
 *
 * Only construction_method 0 (absolute file offsets, data_reference_index 0
 * = this file) is scrubbed. Items stored in `idat` (method 1) or built from
 * other items (method 2) are left untouched — encoders (libavif, Apple,
 * Android) store Exif in `mdat` with method 0. Extents with length 0 ("to
 * end of file") are also skipped rather than zeroing the whole file.
 *
 * @returns the number of byte ranges zeroed (0 → buffer untouched).
 */
export function scrubAvifExifItems(buffer: Uint8Array): number {
  try {
    if (buffer.length < 16 || readType(buffer, 4) !== "ftyp") return 0;
    const top = readBoxes(buffer, 0, buffer.length);
    const meta = top.find((box) => box.type === "meta");
    if (!meta) return 0;
    // ISO BMFF `meta` is a FullBox.
    const children = readBoxes(buffer, meta.payloadStart + 4, meta.end);
    const iinf = children.find((box) => box.type === "iinf");
    const iloc = children.find((box) => box.type === "iloc");
    if (!iinf || !iloc) return 0;

    const { exif, xmp } = metadataItemIds(buffer, iinf);
    if (exif.size === 0 && xmp.size === 0) return 0;
    const locations = parseIloc(buffer, iloc);

    const ranges: ByteRange[] = [];
    for (const itemId of [...exif, ...xmp]) {
      const item = locations.get(itemId);
      if (!item || item.constructionMethod !== 0 || item.dataReferenceIndex !== 0) continue;
      item.extents.forEach((extent, index) => {
        if (extent.length === 0) return;
        const keepHeader = exif.has(itemId) && index === 0 ? 4 : 0;
        const start = extent.offset + Math.min(keepHeader, extent.length);
        const endOffset = extent.offset + extent.length;
        if (endOffset > buffer.length || start >= endOffset) return;
        ranges.push([start, endOffset]);
      });
    }
    return zeroRanges(buffer, ranges);
  } catch {
    return 0;
  }
}
