import { describe, expect, it } from "vitest";
import { isVideoContentType, rangeStillValid, resolveByteRange } from "./byte-range";

const SIZE = 10_000;

describe("resolveByteRange", () => {
  it("sends the whole object without a Range header", () => {
    expect(resolveByteRange(null, SIZE)).toEqual({ type: "full" });
    expect(resolveByteRange(undefined, SIZE)).toEqual({ type: "full" });
    expect(resolveByteRange("   ", SIZE)).toEqual({ type: "full" });
  });

  it("answers a single range, as Safari's first probe and a player's fetch", () => {
    expect(resolveByteRange("bytes=0-1023", SIZE)).toEqual({
      type: "partial",
      start: 0,
      end: 1023,
      length: 1024,
    });
    expect(resolveByteRange("bytes=0-1", SIZE)).toEqual({
      type: "partial",
      start: 0,
      end: 1,
      length: 2,
    });
    expect(resolveByteRange("bytes=5-5", SIZE)).toEqual({
      type: "partial",
      start: 5,
      end: 5,
      length: 1,
    });
  });

  it("answers a suffix range with the last bytes", () => {
    expect(resolveByteRange("bytes=-500", SIZE)).toEqual({
      type: "partial",
      start: 9_500,
      end: 9_999,
      length: 500,
    });
    // A suffix longer than the object is the whole object, still as a range.
    expect(resolveByteRange("bytes=-20000", SIZE)).toEqual({
      type: "partial",
      start: 0,
      end: 9_999,
      length: SIZE,
    });
  });

  it("answers an open-ended range to the last byte", () => {
    expect(resolveByteRange("bytes=100-", SIZE)).toEqual({
      type: "partial",
      start: 100,
      end: 9_999,
      length: 9_900,
    });
    expect(resolveByteRange("bytes=0-", SIZE)).toEqual({
      type: "partial",
      start: 0,
      end: 9_999,
      length: SIZE,
    });
  });

  it("cuts a range that ends past the object at its last byte", () => {
    expect(resolveByteRange("bytes=9000-99999", SIZE)).toEqual({
      type: "partial",
      start: 9_000,
      end: 9_999,
      length: 1_000,
    });
  });

  it("sends the whole object for several ranges (documented choice)", () => {
    expect(resolveByteRange("bytes=0-1,5-6", SIZE)).toEqual({ type: "full" });
    expect(resolveByteRange("bytes=0-1, -5", SIZE)).toEqual({ type: "full" });
  });

  it("ignores a range unit it does not know", () => {
    expect(resolveByteRange("items=0-1", SIZE)).toEqual({ type: "full" });
    expect(resolveByteRange("0-1", SIZE)).toEqual({ type: "full" });
  });

  it("accepts the unit in any case", () => {
    expect(resolveByteRange("Bytes=0-9", SIZE)).toMatchObject({ type: "partial", length: 10 });
  });

  it("refuses ranges that start at or after the end (416)", () => {
    expect(resolveByteRange(`bytes=${SIZE}-`, SIZE)).toEqual({ type: "unsatisfiable" });
    expect(resolveByteRange(`bytes=${SIZE}-${SIZE + 10}`, SIZE)).toEqual({
      type: "unsatisfiable",
    });
    expect(resolveByteRange("bytes=-0", SIZE)).toEqual({ type: "unsatisfiable" });
  });

  it("refuses malformed byte ranges (416)", () => {
    for (const header of [
      "bytes=",
      "bytes=-",
      "bytes=abc",
      "bytes=5-2",
      "bytes=1-2-3",
      "bytes=-1-2",
      "bytes=1.5-2",
      "bytes=+1-2",
      "bytes=0x10-20",
      "bytes= 1 - 2",
      "bytes=1-2\r\nX-Injected: yes",
    ]) {
      expect(resolveByteRange(header, SIZE), header).toEqual({ type: "unsatisfiable" });
    }
  });

  it("handles huge and padded numbers without losing precision", () => {
    const huge = "9".repeat(400);
    expect(resolveByteRange(`bytes=${huge}-`, SIZE)).toEqual({ type: "unsatisfiable" });
    expect(resolveByteRange(`bytes=0-${huge}`, SIZE)).toEqual({
      type: "partial",
      start: 0,
      end: 9_999,
      length: SIZE,
    });
    expect(resolveByteRange(`bytes=-${huge}`, SIZE)).toEqual({
      type: "partial",
      start: 0,
      end: 9_999,
      length: SIZE,
    });
    expect(resolveByteRange(`bytes=${"0".repeat(30)}7-${"0".repeat(30)}9`, SIZE)).toEqual({
      type: "partial",
      start: 7,
      end: 9,
      length: 3,
    });
    // 2^53 + 1 is not an exact Number; such a start is still past any object.
    expect(resolveByteRange("bytes=9007199254740993-", SIZE)).toEqual({ type: "unsatisfiable" });
  });

  it("refuses every range on an empty or unknown-size object", () => {
    expect(resolveByteRange("bytes=0-0", 0)).toEqual({ type: "unsatisfiable" });
    expect(resolveByteRange("bytes=-1", 0)).toEqual({ type: "unsatisfiable" });
    expect(resolveByteRange("bytes=0-0", Number.NaN)).toEqual({ type: "unsatisfiable" });
    expect(resolveByteRange("bytes=0-0", -1)).toEqual({ type: "unsatisfiable" });
    expect(resolveByteRange(null, 0)).toEqual({ type: "full" });
  });
});

describe("rangeStillValid", () => {
  it("applies the range without If-Range", () => {
    expect(rangeStillValid(null, '"a"')).toBe(true);
    expect(rangeStillValid(undefined, undefined)).toBe(true);
  });

  it("applies the range only for the same strong ETag", () => {
    expect(rangeStillValid('"a"', '"a"')).toBe(true);
    expect(rangeStillValid('"b"', '"a"')).toBe(false);
    expect(rangeStillValid('W/"a"', 'W/"a"')).toBe(false);
    expect(rangeStillValid("Wed, 21 Oct 2026 07:28:00 GMT", '"a"')).toBe(false);
    expect(rangeStillValid('"a"', undefined)).toBe(false);
  });
});

describe("isVideoContentType", () => {
  it("recognises the stored video types", () => {
    expect(isVideoContentType("video/mp4")).toBe(true);
    expect(isVideoContentType("video/webm")).toBe(true);
    expect(isVideoContentType("Video/MP4; codecs=avc1")).toBe(true);
    expect(isVideoContentType("video/quicktime")).toBe(true);
  });

  it("treats everything else as not a video", () => {
    expect(isVideoContentType("image/jpeg")).toBe(false);
    expect(isVideoContentType("application/octet-stream")).toBe(false);
    expect(isVideoContentType("text/html")).toBe(false);
    expect(isVideoContentType("video/x-unknown")).toBe(false);
    expect(isVideoContentType("")).toBe(false);
    expect(isVideoContentType(null)).toBe(false);
    expect(isVideoContentType(undefined)).toBe(false);
  });
});
