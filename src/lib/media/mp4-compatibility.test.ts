import { Blob } from "node:buffer";
import { describe, expect, it } from "vitest";
import { hasCompatibleMp4Tracks } from "./mp4-compatibility";

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const size = 8 + payload.reduce((sum, bytes) => sum + bytes.length, 0);
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(
    Array.from(type, (c) => c.charCodeAt(0)),
    4
  );
  let offset = 8;
  for (const data of payload) {
    bytes.set(data, offset);
    offset += data.length;
  }
  return bytes;
}
function track(codec: string) {
  return box(
    "trak",
    box(
      "mdia",
      box("minf", box("stbl", box("stsd", new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]), box(codec))))
    )
  );
}
async function inspect(...bytes: Uint8Array[]) {
  return hasCompatibleMp4Tracks(
    new Blob(bytes.map((part) => new Uint8Array(part))) as unknown as globalThis.Blob
  );
}
describe("MP4 track compatibility", () => {
  it("accepts H.264/AAC and silent H.264 with metadata after the video data", async () => {
    expect(
      await inspect(box("mdat", new Uint8Array(50)), box("moov", track("avc1"), track("mp4a")))
    ).toBe(true);
    expect(await inspect(box("moov", track("avc3")))).toBe(true);
  });
  it.each(["hvc1", "hev1", "av01", "encv"])("requires conversion for %s", async (codec) => {
    expect(await inspect(box("moov", track(codec), track("mp4a")))).toBe(false);
  });
  it("rejects missing video tracks, malformed lengths, and codec strings in unrelated data", async () => {
    expect(await inspect(box("moov", track("mp4a")))).toBe(false);
    expect(await inspect(box("mdat", track("avc1")))).toBe(false);
    const truncated = box("moov", track("avc1")).slice(0, -1);
    expect(await inspect(truncated)).toBe(false);
    expect(await inspect(new Uint8Array(16))).toBe(false);
  });
});
