import { describe, it, expect, vi } from "vitest";

// Mock the blurhash module
vi.mock("blurhash", () => ({
  encode: vi.fn(() => "LEHV6nWB2yk8pyo0adR*"),
}));

// Mock Image and canvas APIs
const mockGetImageData = vi.fn(() => ({
  data: new Uint8ClampedArray(32 * 32 * 4),
  width: 32,
  height: 32,
}));

const mockDrawImage = vi.fn();
const mockGetContext = vi.fn(() => ({
  drawImage: mockDrawImage,
  getImageData: mockGetImageData,
}));

// @ts-expect-error - partial mock
globalThis.Image = class MockImage {
  naturalWidth = 1080;
  naturalHeight = 1350;
  _onload: (() => void) | null = null;
  _onerror: (() => void) | null = null;

  addEventListener(type: string, fn: () => void) {
    if (type === "load") this._onload = fn;
    if (type === "error") this._onerror = fn;
  }

  set src(_url: string) {
    // Fire load async
    queueMicrotask(() => this._onload?.());
  }
};

vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
  if (tag === "canvas") {
    return { width: 0, height: 0, getContext: mockGetContext } as unknown as HTMLCanvasElement;
  }
  return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
});

vi.stubGlobal(
  "URL",
  Object.assign(globalThis.URL, {
    createObjectURL: vi.fn(() => "blob:mock/1234"),
    revokeObjectURL: vi.fn(),
  })
);

const { generateBlurHash } = await import("@/lib/utils/blurhash");

describe("generateBlurHash", () => {
  it("generates a BlurHash string from an image file", async () => {
    const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });
    const hash = await generateBlurHash(file);
    expect(hash).toBe("LEHV6nWB2yk8pyo0adR*");
  });

  it("returns null for failed encoding", async () => {
    const { encode } = await import("blurhash");
    vi.mocked(encode).mockImplementationOnce(() => {
      throw new Error("fail");
    });
    const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });
    const hash = await generateBlurHash(file);
    expect(hash).toBeNull();
  });
});
