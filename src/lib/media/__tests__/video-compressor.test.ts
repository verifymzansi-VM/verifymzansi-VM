import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted() so they're available inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockExec,
  mockWriteFile,
  mockReadFile,
  mockDeleteFile,
  mockTerminate,
  mockLoad,
  mockOn,
  mockFetchFile,
} = vi.hoisted(() => ({
  mockExec: vi.fn().mockResolvedValue(undefined),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockReadFile: vi.fn().mockResolvedValue(new Uint8Array(500_000)),
  mockDeleteFile: vi.fn().mockResolvedValue(undefined),
  mockTerminate: vi.fn(),
  mockLoad: vi.fn().mockResolvedValue(undefined),
  mockOn: vi.fn(),
  mockFetchFile: vi.fn().mockResolvedValue(new Uint8Array(10)),
}));

vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: class MockFFmpeg {
    load = mockLoad;
    exec = mockExec;
    writeFile = mockWriteFile;
    readFile = mockReadFile;
    deleteFile = mockDeleteFile;
    terminate = mockTerminate;
    on = mockOn;
  },
}));

vi.mock("@ffmpeg/util", () => ({
  fetchFile: mockFetchFile,
}));

// ---------------------------------------------------------------------------
// Mock the <video> element used by readVideoDimensions (private helper inside
// video-compressor.ts).  jsdom has no real media decoding, so we simulate
// loadedmetadata via a minimal stub.
// ---------------------------------------------------------------------------

function createMockVideo(width: number, height: number, duration: number) {
  const listeners: Record<string, EventListener> = {};
  return {
    preload: "",
    videoWidth: width,
    videoHeight: height,
    duration,
    set src(_url: string) {
      // Trigger loadedmetadata asynchronously (mirrors real browser behaviour)
      setTimeout(() => listeners["loadedmetadata"]?.(new Event("loadedmetadata")), 0);
    },
    addEventListener(event: string, handler: EventListener) {
      listeners[event] = handler;
    },
    remove: vi.fn(),
  };
}

let mockVideoMeta = { width: 1920, height: 1080, duration: 30 };

beforeEach(() => {
  mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
  vi.clearAllMocks();

  // Restore default mock implementations after clearAllMocks
  mockReadFile.mockResolvedValue(new Uint8Array(500_000));
  mockLoad.mockResolvedValue(undefined);
  mockExec.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);

  vi.stubGlobal(
    "URL",
    Object.assign({}, globalThis.URL, {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    })
  );

  // Intercept document.createElement to return a mock <video> when requested
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    (tag: string, opts?: ElementCreationOptions) => {
      if (tag === "video") {
        return createMockVideo(
          mockVideoMeta.width,
          mockVideoMeta.height,
          mockVideoMeta.duration
        ) as unknown as HTMLElement;
      }
      return origCreate(tag, opts);
    }
  );
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { compressVideo } from "@/lib/media/video-compressor";

// Helper: create a File with a given size.
function fakeFile(sizeBytes: number, name = "test.mp4", type = "video/mp4"): File {
  const buf = new ArrayBuffer(sizeBytes);
  return new File([buf], name, { type });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compressVideo", () => {
  it("skips compression for files below the size threshold", async () => {
    const small = fakeFile(1 * 1024 * 1024); // 1 MB — below default 2 MB threshold
    const result = await compressVideo(small);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("below");
    expect(result.file).toBe(small); // returns original
    expect(result.compressionRatio).toBe(1);
    expect(mockLoad).not.toHaveBeenCalled(); // FFmpeg never loaded
  });

  it("does not skip small QuickTime files because R2 upload requires MP4/WebM", async () => {
    const smallMov = fakeFile(1 * 1024 * 1024, "clip.mov", "video/quicktime");
    const result = await compressVideo(smallMov);

    expect(result.skipped).toBe(false);
    expect(result.file.type).toBe("video/mp4");
    expect(result.file.name).toBe("clip.mp4");
    expect(mockLoad).toHaveBeenCalled();
  });

  it("skips compression for small custom threshold", async () => {
    const file = fakeFile(500_000); // 500 KB
    const result = await compressVideo(file, { skipBelowBytes: 1_000_000 });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("below");
  });

  it("skips when video is already ≤720p and low bitrate", async () => {
    // 720p, 30s, 3 MB → ~800 Kbps (below 2 Mbps threshold)
    mockVideoMeta = { width: 1280, height: 720, duration: 30 };
    const file = fakeFile(3 * 1024 * 1024);

    const result = await compressVideo(file);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("Already");
    expect(result.file).toBe(file);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("skips when portrait video fits within max dimension and low bitrate", async () => {
    // Portrait 720×1280, 30s, 3 MB → low bitrate
    mockVideoMeta = { width: 720, height: 1280, duration: 30 };
    const file = fakeFile(3 * 1024 * 1024);

    const result = await compressVideo(file);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("Already");
  });

  it("does NOT skip when resolution exceeds max dimension", async () => {
    // 1920×1080, 30s, 10 MB → needs compression
    mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
    const file = fakeFile(10 * 1024 * 1024);

    const result = await compressVideo(file);

    expect(result.skipped).toBe(false);
    expect(mockLoad).toHaveBeenCalled();
    expect(mockExec).toHaveBeenCalled();
  });

  it("does NOT skip when bitrate is high even at 720p", async () => {
    // 1280×720, 10s, 10 MB → ~8 Mbps (above 2 Mbps threshold)
    mockVideoMeta = { width: 1280, height: 720, duration: 10 };
    const file = fakeFile(10 * 1024 * 1024);

    const result = await compressVideo(file);

    expect(result.skipped).toBe(false);
    expect(mockLoad).toHaveBeenCalled();
  });

  it("returns compressed file with correct metadata", async () => {
    mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
    const original = fakeFile(10 * 1024 * 1024, "video.mov", "video/quicktime");

    const result = await compressVideo(original);

    expect(result.skipped).toBe(false);
    expect(result.originalSize).toBe(10 * 1024 * 1024);
    expect(result.compressedSize).toBeLessThan(result.originalSize);
    expect(result.compressionRatio).toBeGreaterThan(1);
    expect(result.file.type).toBe("video/mp4");
    expect(result.file.name).toBe("video.mp4"); // extension changed
  });

  it("returns original file if compressed output is larger", async () => {
    mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
    const original = fakeFile(3 * 1024 * 1024); // 3 MB

    // Mock FFmpeg returning a larger file (4 MB)
    mockReadFile.mockResolvedValueOnce(new Uint8Array(4 * 1024 * 1024));

    const result = await compressVideo(original);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("larger");
    expect(result.file).toBe(original);
  });

  it("keeps larger MP4 output for QuickTime input so upload validation can pass", async () => {
    mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
    const original = fakeFile(3 * 1024 * 1024, "clip.mov", "video/quicktime");

    mockReadFile.mockResolvedValueOnce(new Uint8Array(4 * 1024 * 1024));

    const result = await compressVideo(original);

    expect(result.skipped).toBe(false);
    expect(result.file).not.toBe(original);
    expect(result.file.type).toBe("video/mp4");
    expect(result.file.name).toBe("clip.mp4");
  });

  it("adds an MP4 extension when compressed phone video has no extension", async () => {
    mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
    const original = fakeFile(3 * 1024 * 1024, "1000061870", "video/quicktime");

    const result = await compressVideo(original);

    expect(result.skipped).toBe(false);
    expect(result.file.type).toBe("video/mp4");
    expect(result.file.name).toBe("1000061870.mp4");
  });

  it("falls back to original on FFmpeg failure", async () => {
    mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
    const original = fakeFile(10 * 1024 * 1024);

    mockLoad.mockRejectedValueOnce(new Error("WASM failed to load"));

    const result = await compressVideo(original);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("failed");
    expect(result.file).toBe(original);
    expect(result.compressionRatio).toBe(1);
  });

  it("throws AbortError when signal is already aborted", async () => {
    mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
    const file = fakeFile(10 * 1024 * 1024);
    const controller = new AbortController();
    controller.abort();

    await expect(compressVideo(file, { signal: controller.signal })).rejects.toThrow(
      "Compression aborted"
    );
  });

  it("includes scale filter in FFmpeg arguments", async () => {
    mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
    const file = fakeFile(10 * 1024 * 1024);

    await compressVideo(file);

    const args = mockExec.mock.calls[mockExec.mock.calls.length - 1][0] as string[];
    const vfIndex = args.indexOf("-vf");
    expect(vfIndex).toBeGreaterThan(-1);
    const filterStr = args[vfIndex + 1];
    expect(filterStr).toContain("scale=");
    expect(filterStr).toContain("1280"); // max dimension
    expect(filterStr).toContain("pad=");
  });

  it("passes -movflags +faststart for instant playback", async () => {
    mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
    const file = fakeFile(10 * 1024 * 1024);

    await compressVideo(file);

    const args = mockExec.mock.calls[mockExec.mock.calls.length - 1][0] as string[];
    const movflagsIdx = args.indexOf("-movflags");
    expect(movflagsIdx).toBeGreaterThan(-1);
    expect(args[movflagsIdx + 1]).toBe("+faststart");
  });

  it("uses H.264 baseline profile", async () => {
    mockVideoMeta = { width: 1920, height: 1080, duration: 30 };
    const file = fakeFile(10 * 1024 * 1024);

    await compressVideo(file);

    const args = mockExec.mock.calls[mockExec.mock.calls.length - 1][0] as string[];
    expect(args).toContain("libx264");
    expect(args).toContain("baseline");
  });
});
