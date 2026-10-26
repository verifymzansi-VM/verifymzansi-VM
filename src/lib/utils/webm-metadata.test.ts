import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { scrubWebmMetadata } from "./webm-metadata";

const id = (value: number) => {
  const hex = value.toString(16);
  return Array.from(Buffer.from(hex.length % 2 ? "0" + hex : hex, "hex"));
};
function size(value: number, width = 1) {
  const bytes = new Array(width).fill(0);
  for (let i = width - 1; i >= 0; i--) {
    bytes[i] = value % 256;
    value = Math.floor(value / 256);
  }
  bytes[0] |= 2 ** (8 - width);
  return bytes;
}
const text = (value: string) => Array.from(new TextEncoder().encode(value));
const element = (type: number, payload: number[], width = 1) => [
  ...id(type),
  ...size(payload.length, width),
  ...payload,
];
const header = element(0x1a45dfa3, element(0x4282, text("webm")));
const cluster = element(0x1f43b675, element(0xa3, [0x81, 0, 0, 0x80, 9, 8, 7]));
const tags = element(0x1254c367, element(0x7373, element(0x4487, text("GPS=-33.9,18.4"))));
function file(payload: number[], unknown = false) {
  return new Uint8Array([
    ...header,
    ...id(0x18538067),
    ...(unknown ? [1, 255, 255, 255, 255, 255, 255, 255] : size(payload.length, 4)),
    ...payload,
  ]);
}

describe("WebM metadata privacy", () => {
  it("accepts an actual Chrome MediaRecorder VP9 file and strips appended container tags", () => {
    // Synthetic blue canvas, recorded locally; contains no camera/person data.
    const camera = readFileSync("src/lib/utils/__fixtures__/chrome-vp9.webm");
    const segment = camera.indexOf(Buffer.from(id(0x18538067)));
    expect(segment).toBeGreaterThan(0);
    expect(camera[segment + 4]).toBe(1); // Original eight-byte segment size
    camera.fill(255, segment + 5, segment + 12); // Streaming segment, same width
    const bytes = new Uint8Array([...camera, ...tags]);
    expect(scrubWebmMetadata(bytes)).toBe(1);
    expect(bytes.subarray(0, camera.length)).toEqual(new Uint8Array(camera));
    expect(new TextDecoder().decode(bytes)).not.toContain("GPS=");
  });
  it("removes location tags without moving or changing media blocks", () => {
    const bytes = file([...tags, ...cluster]);
    const before = bytes.slice();
    expect(scrubWebmMetadata(bytes)).toBe(1);
    expect(new TextDecoder().decode(bytes)).not.toContain("GPS=");
    expect(bytes.length).toBe(before.length);
    expect(bytes.slice(-cluster.length)).toEqual(before.slice(-cluster.length));
    expect(scrubWebmMetadata(bytes)).toBe(0);
  });
  it("removes recording dates, titles, track names, attachments and invalidated CRCs", () => {
    const info = element(0x1549a966, [
      ...element(0xbf, [1, 2, 3, 4]),
      ...element(0x7ba9, text("PRIVATE TITLE")),
      ...element(0x4461, new Array(8).fill(1)),
    ]);
    const tracks = element(0x1654ae6b, element(0xae, element(0x536e, text("HOME ADDRESS"))));
    const bytes = file([
      ...element(0xbf, [1, 2, 3, 4]),
      ...info,
      ...tracks,
      ...element(0x1941a469, text("EXIF GPS")),
      ...cluster,
    ]);
    expect(scrubWebmMetadata(bytes)).toBe(6);
    expect(new TextDecoder().decode(bytes)).not.toMatch(/PRIVATE|ADDRESS|GPS/);
    expect(bytes.slice(-cluster.length)).toEqual(new Uint8Array(cluster));
  });
  it("finds tags after unknown-size streaming clusters, without scanning block payloads", () => {
    const block = element(0xa3, [...text("SAMPLE"), ...id(0x1254c367), 0xff]);
    const streaming = [...id(0x1f43b675), 0xff, ...element(0xe7, [0]), ...block];
    const bytes = file([...streaming, ...tags, ...cluster], true);
    const before = bytes.slice();
    expect(scrubWebmMetadata(bytes)).toBe(1);
    expect(bytes.slice(header.length + 12, header.length + 12 + streaming.length)).toEqual(
      before.slice(header.length + 12, header.length + 12 + streaming.length)
    );
    expect(new TextDecoder().decode(bytes)).not.toContain("GPS=");
  });
  it("encodes a same-size Void for large metadata payloads", () => {
    const bytes = file([...element(0x1254c367, new Array(20_000).fill(65), 3), ...cluster]);
    const length = bytes.length;
    expect(scrubWebmMetadata(bytes)).toBe(1);
    expect(bytes.length).toBe(length);
    expect(scrubWebmMetadata(bytes)).toBe(0);
    expect(bytes.slice(-cluster.length)).toEqual(new Uint8Array(cluster));
  });
  it.each([
    [0, 1, 2],
    [...header, ...id(0x18538067), 0x8f, ...tags],
    [...header, ...id(0x18538067), 0xff, ...id(0x1254c367), 0xff],
    [...header, ...id(0x18538067), 0xff, ...tags, 0],
    [...element(0x1a45dfa3, element(0x4282, text("matroska"))), ...id(0x18538067), 0x80],
  ])("rejects malformed or unsupported framing before mutation (%#)", (...input) => {
    const bytes = new Uint8Array(input);
    const before = bytes.slice();
    expect(() => scrubWebmMetadata(bytes)).toThrow();
    expect(bytes).toEqual(before);
  });
});
