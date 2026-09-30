import { describe, expect, it } from "vitest";
import { scrubAvifExifItems, scrubVideoLocationMetadata } from "./isobmff-metadata";
import { stripMetadataFromAvif } from "./exif-strip";

// ── Synthetic ISO BMFF builders ─────────────────────────────────────────────

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0xff);
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u64 = (n: number) => [...u32(Math.floor(n / 0x1_0000_0000)), ...u32(n >>> 0)];

function box(type: string, ...parts: number[][]): number[] {
  const payload = parts.flat();
  return [...u32(8 + payload.length), ...ascii(type), ...payload];
}

function largeBox(type: string, ...parts: number[][]): number[] {
  const payload = parts.flat();
  return [...u32(1), ...ascii(type), ...u64(16 + payload.length), ...payload];
}

function fullBox(type: string, version: number, flags: number, ...parts: number[][]): number[] {
  return box(type, [version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff], ...parts);
}

function indexOf(haystack: Uint8Array, needle: string): number {
  const bytes = ascii(needle);
  outer: for (let i = 0; i + bytes.length <= haystack.length; i += 1) {
    for (let j = 0; j < bytes.length; j += 1) if (haystack[i + j] !== bytes[j]) continue outer;
    return i;
  }
  return -1;
}

/** Every byte outside [start,end) ranges must be identical. */
function expectOnlyRangesChanged(before: Uint8Array, after: Uint8Array) {
  expect(after.length).toBe(before.length);
  let changed = 0;
  for (let i = 0; i < before.length; i += 1) if (before[i] !== after[i]) changed += 1;
  return changed;
}

const ANDROID_GPS = "+37.4219-122.0840/";
const APPLE_GPS = "+33.9249+018.4241+012.000/";
const XYZ = "©xyz";

const ftypMp4 = box("ftyp", ascii("isom"), u32(0x200), ascii("isomiso2avc1mp41"));
const mvhd = fullBox("mvhd", 0, 0, new Array(96).fill(1));
/** stco with one chunk offset — must be untouched by scrubbing. */
const trak = box(
  "trak",
  box("mdia", box("minf", box("stbl", fullBox("stco", 0, 0, u32(1), u32(0x1234)))))
);
const mdat = box("mdat", ascii("VIDEO-SAMPLES-VIDEO-SAMPLES"));

/** QuickTime user-data text atom: u16 length + u16 language + string. */
function qtTextAtom(type: string, text: string): number[] {
  return box(type, u16(text.length), u16(0x15c7), ascii(text));
}

function dataAtom(text: string): number[] {
  return box("data", u32(1), u32(0), ascii(text));
}

function appleMeta(): number[] {
  const hdlr = fullBox("hdlr", 0, 0, u32(0), ascii("mdta"), new Array(12).fill(0), [0]);
  const key = (name: string) => [...u32(8 + name.length), ...ascii("mdta"), ...ascii(name)];
  const keys = fullBox(
    "keys",
    0,
    0,
    u32(3),
    key("com.apple.quicktime.make"),
    key("com.apple.quicktime.location.ISO6709"),
    key("com.apple.quicktime.location.accuracy.horizontal")
  );
  const item = (index: number, value: string) => [
    ...u32(8 + 8 + 8 + value.length),
    ...u32(index),
    ...dataAtom(value),
  ];
  const ilst = box("ilst", item(1, "Apple"), item(2, APPLE_GPS), item(3, "4.718"));
  // QuickTime-style meta: NOT a FullBox (no version/flags).
  return box("meta", hdlr, keys, ilst);
}

// ── Video ───────────────────────────────────────────────────────────────────

describe("scrubVideoLocationMetadata", () => {
  it("blanks an Android udta/©xyz ISO 6709 string without changing any size or offset", () => {
    const file = new Uint8Array([
      ...ftypMp4,
      ...box("moov", mvhd, trak, box("udta", qtTextAtom(XYZ, ANDROID_GPS))),
      ...mdat,
    ]);
    const before = file.slice();

    expect(scrubVideoLocationMetadata(file)).toBe(1);

    expect(indexOf(file, ANDROID_GPS)).toBe(-1);
    expect(indexOf(file, "+37.4219")).toBe(-1);
    expect(expectOnlyRangesChanged(before, file)).toBe(ANDROID_GPS.length);
    // Box structure (the ©xyz header + length/lang prefix) is still intact.
    const xyzAt = indexOf(file, XYZ) - 4;
    expect(xyzAt).toBeGreaterThan(0);
    expect(Array.from(file.slice(xyzAt + 8, xyzAt + 12))).toEqual([
      ...u16(ANDROID_GPS.length),
      ...u16(0x15c7),
    ]);
    // stco chunk offset and mdat untouched.
    expect(indexOf(file, "VIDEO-SAMPLES-VIDEO-SAMPLES")).toBeGreaterThan(0);
    expect(file.join(",")).toContain(u32(0x1234).join(","));
  });

  it("blanks Apple mdta com.apple.quicktime.location.* values but keeps other keys", () => {
    const file = new Uint8Array([
      ...ftypMp4,
      ...box("moov", mvhd, appleMeta(), trak, box("udta", qtTextAtom(XYZ, APPLE_GPS))),
      ...mdat,
    ]);
    const before = file.slice();

    expect(scrubVideoLocationMetadata(file)).toBe(3);

    expect(indexOf(file, APPLE_GPS)).toBe(-1);
    expect(indexOf(file, "4.718")).toBe(-1);
    expect(indexOf(file, "Apple")).toBeGreaterThan(0); // make is not location
    // Key names themselves are left (they are not location values).
    expect(indexOf(file, "com.apple.quicktime.location.ISO6709")).toBeGreaterThan(0);
    expect(expectOnlyRangesChanged(before, file)).toBe(APPLE_GPS.length * 2 + "4.718".length);
  });

  it("blanks iTunes-style udta/meta(FullBox)/ilst/©xyz data atoms and 3GPP loci", () => {
    const hdlr = fullBox("hdlr", 0, 0, u32(0), ascii("mdir"), new Array(12).fill(0), [0]);
    const ilst = box("ilst", box(XYZ, dataAtom(ANDROID_GPS)));
    const loci = fullBox(
      "loci",
      0,
      0,
      u16(0x15c7),
      ascii("Home\0"),
      [0],
      u32(0x001e0000),
      u32(0xffe20000),
      u32(0),
      ascii("earth\0"),
      [0]
    );
    const file = new Uint8Array([
      ...ftypMp4,
      ...box("moov", mvhd, box("udta", fullBox("meta", 0, 0, hdlr, ilst), loci)),
    ]);

    expect(scrubVideoLocationMetadata(file)).toBe(2);
    expect(indexOf(file, ANDROID_GPS)).toBe(-1);
    expect(indexOf(file, "Home")).toBe(-1);
    expect(indexOf(file, "earth")).toBe(-1);
  });

  it("handles 64-bit (size == 1) boxes", () => {
    const file = new Uint8Array([
      ...ftypMp4,
      ...largeBox("moov", mvhd, largeBox("udta", qtTextAtom(XYZ, ANDROID_GPS))),
      ...mdat,
    ]);
    expect(scrubVideoLocationMetadata(file)).toBe(1);
    expect(indexOf(file, ANDROID_GPS)).toBe(-1);
  });

  it("handles a final box with size == 0 (extends to end of file)", () => {
    const moov = box("moov", mvhd, box("udta", qtTextAtom(XYZ, ANDROID_GPS)));
    moov.splice(0, 4, ...u32(0));
    const file = new Uint8Array([...ftypMp4, ...mdat, ...moov]);
    expect(scrubVideoLocationMetadata(file)).toBe(1);
    expect(indexOf(file, ANDROID_GPS)).toBe(-1);
  });

  it("leaves files without location metadata byte-for-byte unchanged", () => {
    const file = new Uint8Array([...ftypMp4, ...box("moov", mvhd, trak), ...mdat]);
    const before = file.slice();
    expect(scrubVideoLocationMetadata(file)).toBe(0);
    expect(file).toEqual(before);
  });

  it("never throws on malformed or truncated input", () => {
    const good = [...ftypMp4, ...box("moov", mvhd, box("udta", qtTextAtom(XYZ, ANDROID_GPS)))];
    const samples: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([0, 0, 0]),
      new Uint8Array(good.slice(0, good.length - 7)), // truncated mid-©xyz
      new Uint8Array([...u32(0xffffffff), ...ascii("moov"), 1, 2, 3]), // size past EOF
      new Uint8Array([...u32(3), ...ascii("moov"), 1, 2, 3]), // size < header
      new Uint8Array([...u32(1), ...ascii("moov"), ...u32(0xffffffff), ...u32(0)]), // huge largesize
      new Uint8Array([...ftypMp4, ...box("moov", box("meta", fullBox("keys", 0, 0, u32(999999))))]),
    ];
    // Deep nesting beyond the depth cap.
    let deep = qtTextAtom(XYZ, ANDROID_GPS);
    for (let i = 0; i < 40; i += 1) deep = box("udta", deep);
    samples.push(new Uint8Array(deep));
    // Random garbage.
    let seed = 42;
    for (let n = 0; n < 50; n += 1) {
      const junk = new Uint8Array(64);
      for (let i = 0; i < junk.length; i += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        junk[i] = seed & 0xff;
      }
      samples.push(junk);
    }

    for (const sample of samples) {
      expect(() => scrubVideoLocationMetadata(sample)).not.toThrow();
    }
    // Structurally invalid top-level boxes are left untouched.
    const pastEof = samples[3];
    const copy = pastEof.slice();
    scrubVideoLocationMetadata(pastEof);
    expect(pastEof).toEqual(copy);
  });
});

// ── AVIF ────────────────────────────────────────────────────────────────────

const EXIF_TIFF = [
  ...ascii("MM"),
  0x00,
  0x2a,
  ...u32(8),
  ...ascii("GPSLatitude=33.9249S;GPSLongitude=18.4241E"),
];
const EXIF_PAYLOAD = [...u32(0), ...EXIF_TIFF]; // exif_tiff_header_offset + TIFF
const XMP_PAYLOAD = ascii("<x:xmpmeta><exif:GPSLatitude>33,55.49S</exif:GPSLatitude></x:xmpmeta>");
const IMAGE_PAYLOAD = ascii("AV1-IMAGE-DATA-AV1-IMAGE-DATA");

function infe(version: number, itemId: number, itemType: string, extra: number[] = []) {
  const id = version === 2 ? u16(itemId) : u32(itemId);
  return fullBox("infe", version, 0, id, u16(0), ascii(itemType), ascii("\0"), extra);
}

interface AvifOptions {
  ilocVersion?: 0 | 1 | 2;
  exifConstructionMethod?: number;
  withXmp?: boolean;
  offsetSize?: 4 | 8;
  baseOffsetSize?: 0 | 4 | 8;
  indexSize?: 0 | 4;
  splitExif?: boolean;
}

/** ftyp + meta(hdlr, iinf, iloc) + mdat(image, exif, [xmp]) with correct absolute offsets. */
function buildAvif(opts: AvifOptions = {}): {
  file: Uint8Array;
  exifStart: number;
  xmpStart: number;
} {
  const {
    ilocVersion = 0,
    exifConstructionMethod = 0,
    withXmp = false,
    offsetSize = 4,
    baseOffsetSize = 0,
    indexSize = 0,
    splitExif = false,
  } = opts;

  const build = (mdatDataStart: number) => {
    const imageAt = mdatDataStart;
    const exifAt = imageAt + IMAGE_PAYLOAD.length;
    const xmpAt = exifAt + EXIF_PAYLOAD.length;
    const base = baseOffsetSize > 0 ? imageAt : 0;
    const readUint = (n: number, size: number) => (size === 8 ? u64(n) : size === 4 ? u32(n) : []);
    const ilocItem = (id: number, method: number, extents: Array<[number, number]>) => [
      ...(ilocVersion < 2 ? u16(id) : u32(id)),
      ...(ilocVersion >= 1 ? u16(method & 0x0f) : []),
      ...u16(0), // data_reference_index
      ...readUint(base, baseOffsetSize),
      ...u16(extents.length),
      ...extents.flatMap(([offset, length]) => [
        ...readUint(1, indexSize),
        ...readUint(offset - base, offsetSize),
        ...u32(length),
      ]),
    ];
    const exifExtents: Array<[number, number]> = splitExif
      ? [
          [exifAt, 10],
          [exifAt + 10, EXIF_PAYLOAD.length - 10],
        ]
      : [[exifAt, EXIF_PAYLOAD.length]];
    const items = [
      ilocItem(1, 0, [[imageAt, IMAGE_PAYLOAD.length]]),
      ilocItem(2, exifConstructionMethod, exifExtents),
      ...(withXmp ? [ilocItem(3, 0, [[xmpAt, XMP_PAYLOAD.length]])] : []),
    ];
    const iloc = fullBox(
      "iloc",
      ilocVersion,
      0,
      [(offsetSize << 4) | 4, (baseOffsetSize << 4) | (ilocVersion >= 1 ? indexSize : 0)],
      ilocVersion < 2 ? u16(items.length) : u32(items.length),
      ...items
    );
    const iinfEntries = [
      infe(2, 1, "av01"),
      infe(3, 2, "Exif"),
      ...(withXmp ? [infe(2, 3, "mime", ascii("application/rdf+xml\0"))] : []),
    ];
    const iinf = fullBox("iinf", 0, 0, u16(iinfEntries.length), ...iinfEntries);
    const hdlr = fullBox("hdlr", 0, 0, u32(0), ascii("pict"), new Array(12).fill(0), [0]);
    const meta = fullBox("meta", 0, 0, hdlr, fullBox("pitm", 0, 0, u16(1)), iinf, iloc);
    const ftyp = box("ftyp", ascii("avif"), u32(0), ascii("avifmif1miaf"));
    const mdatBox = box("mdat", IMAGE_PAYLOAD, EXIF_PAYLOAD, withXmp ? XMP_PAYLOAD : []);
    return {
      bytes: [...ftyp, ...meta, ...mdatBox],
      exifAt,
      xmpAt,
      mdatStart: ftyp.length + meta.length,
    };
  };

  const first = build(0);
  const final = build(first.mdatStart + 8);
  return { file: new Uint8Array(final.bytes), exifStart: final.exifAt, xmpStart: final.xmpAt };
}

describe("scrubAvifExifItems", () => {
  it("zeroes the Exif TIFF payload (keeping the 4-byte header offset) and nothing else", () => {
    const { file, exifStart } = buildAvif();
    const before = file.slice();
    expect(indexOf(file, "GPSLatitude")).toBe(exifStart + 4 + 8);

    expect(scrubAvifExifItems(file)).toBe(1);

    expect(indexOf(file, "GPSLatitude")).toBe(-1);
    expect(indexOf(file, "MM")).toBe(-1);
    expect(Array.from(file.slice(exifStart + 4, exifStart + EXIF_PAYLOAD.length))).toEqual(
      new Array(EXIF_TIFF.length).fill(0)
    );
    const changed = expectOnlyRangesChanged(before, file);
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(EXIF_TIFF.length);
    expect(indexOf(file, "AV1-IMAGE-DATA-AV1-IMAGE-DATA")).toBeGreaterThan(0);
  });

  it.each([
    { ilocVersion: 1 as const, baseOffsetSize: 4 as const, indexSize: 4 as const },
    { ilocVersion: 2 as const, offsetSize: 8 as const, baseOffsetSize: 8 as const },
    { ilocVersion: 1 as const, splitExif: true },
  ])("resolves iloc extents for %o", (opts) => {
    const { file } = buildAvif(opts);
    expect(scrubAvifExifItems(file)).toBeGreaterThan(0);
    expect(indexOf(file, "GPSLatitude")).toBe(-1);
    expect(indexOf(file, "AV1-IMAGE-DATA")).toBeGreaterThan(0);
  });

  it("zeroes an XMP (mime application/rdf+xml) item too", () => {
    const { file } = buildAvif({ withXmp: true });
    expect(scrubAvifExifItems(file)).toBe(2);
    expect(indexOf(file, "GPSLatitude")).toBe(-1);
    expect(indexOf(file, "xmpmeta")).toBe(-1);
  });

  it("leaves idat-constructed (construction_method 1) Exif items untouched", () => {
    const { file } = buildAvif({ ilocVersion: 1, exifConstructionMethod: 1 });
    const before = file.slice();
    expect(scrubAvifExifItems(file)).toBe(0);
    expect(file).toEqual(before);
  });

  it("never throws on malformed AVIF input", () => {
    const { file } = buildAvif();
    for (let cut = 0; cut < file.length; cut += 7) {
      expect(() => scrubAvifExifItems(file.slice(0, cut))).not.toThrow();
    }
    const corrupt = file.slice();
    // Point every iloc extent far past EOF.
    const ilocAt = indexOf(corrupt, "iloc") - 4;
    corrupt.fill(0xff, ilocAt + 16, ilocAt + 40);
    expect(() => scrubAvifExifItems(corrupt)).not.toThrow();
  });

  it("stripMetadataFromAvif returns a scrubbed copy and leaves the input intact", () => {
    const { file } = buildAvif();
    const out = stripMetadataFromAvif(file);
    expect(indexOf(out, "GPSLatitude")).toBe(-1);
    expect(indexOf(file, "GPSLatitude")).toBeGreaterThan(0);
    expect(out.length).toBe(file.length);
  });
});
