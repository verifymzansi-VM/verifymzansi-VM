/** Inspect MP4 sample descriptions, not the filename or playback support on this device.
 * Unknown formats require conversion. This is not a full decode/integrity check.
 */
export async function hasCompatibleMp4Tracks(file: Blob): Promise<boolean> {
  const type = (bytes: Uint8Array, offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  let foundVideo = false;
  const inspect = (bytes: Uint8Array, start: number, end: number, depth = 0): boolean => {
    if (depth > 8) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = start;
    while (offset < end) {
      if (offset + 8 > end) return false;
      const size = view.getUint32(offset);
      const kind = type(bytes, offset + 4);
      if (size < 8 || offset + size > end) return false;
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(kind)) {
        if (!inspect(bytes, offset + 8, offset + size, depth + 1)) return false;
      } else if (kind === "stsd") {
        if (size < 16) return false;
        const count = view.getUint32(offset + 12);
        let entry = offset + 16;
        if (!count) return false;
        for (let i = 0; i < count; i++) {
          if (entry + 8 > offset + size) return false;
          const entrySize = view.getUint32(entry);
          const codec = type(bytes, entry + 4);
          if (entrySize < 8 || entry + entrySize > offset + size) return false;
          if (codec === "avc1" || codec === "avc3") foundVideo = true;
          else if (codec !== "mp4a") return false;
          entry += entrySize;
        }
        if (entry !== offset + size) return false;
      }
      offset += size;
    }
    return true;
  };

  try {
    // Skip mdat without copying the video into JS memory. Bound metadata reads.
    for (let offset = 0, boxes = 0; offset + 8 <= file.size && boxes < 1024; boxes++) {
      const bytes = new Uint8Array(await file.slice(offset, offset + 16).arrayBuffer());
      const view = new DataView(bytes.buffer);
      let size = view.getUint32(0);
      const kind = type(bytes, 4);
      if (size === 1) {
        if (bytes.length < 16) return false;
        size = view.getUint32(8) * 2 ** 32 + view.getUint32(12);
      } else if (size === 0) size = file.size - offset;
      if (!Number.isSafeInteger(size) || size < 8 || offset + size > file.size) return false;
      if (kind === "moov") {
        if (size > 4 * 1024 * 1024) return false;
        const metadata = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
        return inspect(metadata, 0, metadata.length) && foundVideo;
      }
      offset += size;
    }
  } catch {
    // Unreadable or malformed metadata must not enable the original-file fallback.
  }
  return false;
}
