import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Stub URL.createObjectURL / revokeObjectURL (jsdom doesn't support blob URLs fully)
vi.stubGlobal(
  "URL",
  Object.assign(globalThis.URL, {
    createObjectURL: vi.fn(() => "blob:mock/1234"),
    revokeObjectURL: vi.fn(),
  })
);

// Mock XMLHttpRequest for video upload tests
class MockXHR {
  uploadListeners: Record<string, ((event: ProgressEvent<EventTarget>) => void)[]> = {};
  listeners: Record<string, (() => void)[]> = {};
  upload = {
    addEventListener: (type: string, listener: (event: ProgressEvent<EventTarget>) => void) => {
      this.uploadListeners[type] ??= [];
      this.uploadListeners[type].push(listener);
    },
  };
  addEventListener = (type: string, listener: () => void) => {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  };
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn(() => {
    queueMicrotask(() => {
      for (const listener of this.uploadListeners.progress ?? []) {
        listener({ lengthComputable: true, loaded: 1, total: 1 } as ProgressEvent<EventTarget>);
      }
      for (const listener of this.listeners.load ?? []) {
        listener();
      }
    });
  });
  status = 200;
}

function MockXMLHttpRequest() {
  return new MockXHR();
}

vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest);

// Make jsdom video elements fire the error event immediately so getVideoDuration
// resolves without waiting for the 10 s timeout (jsdom has no media engine).
const _origCreateElement = document.createElement.bind(document);
vi.spyOn(document, "createElement").mockImplementation(
  (...args: Parameters<typeof document.createElement>) => {
    const el = _origCreateElement(...args);
    if (args[0] === "video") {
      const origSet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")?.set;
      Object.defineProperty(el, "src", {
        set(v: string) {
          if (origSet) origSet.call(this, v);
          // Fire error in microtask so event-listeners registered synchronously
          // after setting src are already attached.
          queueMicrotask(() => (this as HTMLVideoElement).dispatchEvent(new Event("error")));
        },
        configurable: true,
      });
    }
    return el;
  }
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

  it("should reject quicktime video uploads", () => {
    const { result } = renderHook(() => useMediaUpload());
    const movFile = new File(["data"], "clip.mov", { type: "video/quicktime" });
    const error = result.current.validate(movFile);
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
          publicUrl: "https://media.verifymzansi.com/media/listing/user1/video.mp4",
        }),
    });

    const { result } = renderHook(() =>
      useMediaUpload({
        allowedTypes: ["image/jpeg"],
        area: "listing",
      })
    );
    const videoFile = new File(["video-data"], "clip.mp4", { type: "video/mp4" });
    let uploadResult: string | null = null;

    await act(async () => {
      uploadResult = await result.current.upload(videoFile);
    });

    // The first fetch call should be to /api/media/upload-url
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/media/upload-url",
        expect.objectContaining({
          method: "POST",
          headers: expect.any(Headers),
        })
      );
    });

    // Verify Content-Type was forwarded through withCsrfHeaders
    const urlCall = mockFetch.mock.calls.find((c: unknown[]) => c[0] === "/api/media/upload-url");
    const urlCallHeaders = urlCall?.[1]?.headers as Headers | undefined;
    expect(urlCallHeaders?.get("Content-Type")).toBe("application/json");

    expect(uploadResult).toBe("https://media.verifymzansi.com/media/listing/user1/video.mp4");
    expect(result.current.isUploading).toBe(false);
    expect(result.current.progress).toBe(100);
    expect(result.current.error).toBeNull();
    expect(result.current.url).toBe("https://media.verifymzansi.com/media/listing/user1/video.mp4");
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

  it("should expose posterUrl (null initially)", () => {
    const { result } = renderHook(() => useMediaUpload());
    expect(result.current.posterUrl).toBeNull();
  });

  it("should expose blurhash (null initially)", () => {
    const { result } = renderHook(() => useMediaUpload());
    expect(result.current.blurhash).toBeNull();
  });

  it("should reset posterUrl and blurhash", async () => {
    const { result } = renderHook(() => useMediaUpload());

    act(() => {
      result.current.reset();
    });

    expect(result.current.posterUrl).toBeNull();
    expect(result.current.blurhash).toBeNull();
  });
});
