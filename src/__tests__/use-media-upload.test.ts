import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock XMLHttpRequest for video upload tests
class MockXHR {
  upload = { addEventListener: vi.fn() };
  addEventListener = vi.fn();
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  status = 200;
}
vi.stubGlobal(
  "XMLHttpRequest",
  vi.fn(() => new MockXHR())
);

// Dynamic import so mocks are set first
const { useMediaUpload } = await import("@/hooks/use-media-upload");

describe("useMediaUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should start in idle state", () => {
    const { result } = renderHook(() => useMediaUpload());
    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.url).toBeNull();
  });

  it("should validate file size", () => {
    const { result } = renderHook(() => useMediaUpload({ maxSizeMB: 1 }));
    const bigFile = new File(["x".repeat(2 * 1024 * 1024)], "big.jpg", {
      type: "image/jpeg",
    });
    const error = result.current.validate(bigFile);
    expect(error).toBeTruthy();
    expect(error).toMatch(/size/i);
  });

  it("should validate file type", () => {
    const { result } = renderHook(() => useMediaUpload({ allowedTypes: ["image/png"] }));
    const jpgFile = new File(["data"], "photo.jpg", { type: "image/jpeg" });
    const error = result.current.validate(jpgFile);
    expect(error).toBeTruthy();
    expect(error).toMatch(/type/i);
  });

  it("should upload image successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ urls: ["https://r2.example.com/file.jpg"], success: true }),
    });

    const { result } = renderHook(() => useMediaUpload());
    const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });

    let uploadResult: string | null = null;
    await act(async () => {
      uploadResult = await result.current.upload(file);
    });

    expect(uploadResult).toBe("https://r2.example.com/file.jpg");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/media/upload",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("should upload video via presigned URL", async () => {
    // Mock the presigned URL endpoint response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          uploadUrl: "https://r2.example.com/presigned-put",
          key: "media/listing/user1/video.mp4",
          publicUrl: "https://media.verifymzansi.co.za/media/listing/user1/video.mp4",
        }),
    });

    const { result } = renderHook(() =>
      useMediaUpload({
        allowedTypes: ["image/jpeg"],
        area: "listing",
      })
    );
    const videoFile = new File(["video-data"], "clip.mp4", { type: "video/mp4" });

    // Start the upload (will call fetch for presigned URL, then XHR for upload)
    const uploadPromise = act(async () => {
      await result.current.upload(videoFile);
    });

    // The first fetch call should be to /api/media/upload-url
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/media/upload-url",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    await uploadPromise;
  });

  it("should handle upload failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Upload failed" }),
    });

    const { result } = renderHook(() => useMediaUpload());
    const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });

    let uploadResult: string | null = null;
    await act(async () => {
      uploadResult = await result.current.upload(file);
    });

    expect(uploadResult).toBeNull();
    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });

  it("should reset state", async () => {
    const { result } = renderHook(() => useMediaUpload());

    act(() => {
      result.current.reset();
    });

    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.url).toBeNull();
  });
});
