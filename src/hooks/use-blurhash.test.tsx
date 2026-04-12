import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBlurHash } from "@/hooks/use-blurhash";

// Mock blurhash decode
vi.mock("blurhash", () => ({
  decode: vi.fn((hash: string) => {
    if (hash === "INVALID") throw new Error("invalid hash");
    // Return a minimal Uint8ClampedArray for 32x32 pixels (RGBA)
    return new Uint8ClampedArray(32 * 32 * 4).fill(128);
  }),
}));

// Mock canvas
const mockPutImageData = vi.fn();
const mockCreateImageData = vi.fn(() => ({
  data: { set: vi.fn() },
}));
const mockToDataURL = vi.fn(() => "data:image/png;base64,abc123");
const mockGetContext = vi.fn(() => ({
  createImageData: mockCreateImageData,
  putImageData: mockPutImageData,
}));

const mockCanvas = {
  width: 0,
  height: 0,
  getContext: mockGetContext,
  toDataURL: mockToDataURL,
};

const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
  if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
  return originalCreateElement(tag);
});

describe("useBlurHash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToDataURL.mockReturnValue("data:image/png;base64,abc123");
    mockGetContext.mockReturnValue({
      createImageData: mockCreateImageData,
      putImageData: mockPutImageData,
    });
  });

  it("returns empty string for null hash", () => {
    const { result } = renderHook(() => useBlurHash(null));
    expect(result.current).toBe("");
  });

  it("returns empty string for undefined hash", () => {
    const { result } = renderHook(() => useBlurHash(undefined));
    expect(result.current).toBe("");
  });

  it("returns empty string for empty string hash", () => {
    const { result } = renderHook(() => useBlurHash(""));
    expect(result.current).toBe("");
  });

  it("returns a data URL for a valid hash", () => {
    const { result } = renderHook(() => useBlurHash("LEHV6nWB2yk8pyo0"));
    expect(result.current).toBe("data:image/png;base64,abc123");
  });

  it("returns empty string when getContext returns null", () => {
    mockGetContext.mockReturnValueOnce(null);
    const { result } = renderHook(() => useBlurHash("LEHV6nWB_noCtx"));
    expect(result.current).toBe("");
  });

  it("returns empty string when blurhash decode throws", () => {
    const { result } = renderHook(() => useBlurHash("INVALID"));
    expect(result.current).toBe("");
  });

  it("returns the cached value on second render with same params (cache hit branch)", () => {
    const hash = "CACHED_HASH_TEST";
    // First render — populates cache
    const { result, rerender } = renderHook(() => useBlurHash(hash, 32, 32, 1));
    expect(result.current).toBe("data:image/png;base64,abc123");
    // Second render with same params — hits the cache path (canvas not called again)
    const callsBefore = mockToDataURL.mock.calls.length;
    rerender();
    expect(mockToDataURL.mock.calls.length).toBe(callsBefore); // canvas not called again
    expect(result.current).toBe("data:image/png;base64,abc123");
  });
});
