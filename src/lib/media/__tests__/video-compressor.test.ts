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
  mockMount,
  mockUnmount,
} = vi.hoisted(() => ({
  mockExec: vi.fn().mockResolvedValue(0),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockReadFile: vi.fn().mockResolvedValue(new Uint8Array(500_000)),
  mockDeleteFile: vi.fn().mockResolvedValue(undefined),
  mockTerminate: vi.fn(),
  mockLoad: vi.fn().mockResolvedValue(undefined),
  mockOn: vi.fn(),
  mockFetchFile: vi.fn().mockResolvedValue(new Uint8Array(10)),
  // Undefined: the encoder has no mount support, so inputs are copied in.
  mockMount: { current: undefined as ReturnType<typeof vi.fn> | undefined },
  mockUnmount: vi.fn(async () => true),
}));

vi.mock("@ffmpeg/ffmpeg", () => ({
  FFFSType: { WORKERFS: "WORKERFS" },
  FFmpeg: class MockFFmpeg {
    createDir = vi.fn(async () => true);
    deleteDir = vi.fn(async () => true);
    unmount = mockUnmount;
    get mount() {
      return mockMount.current;
    }
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

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFile.mockResolvedValue(new Uint8Array(500_000));
  mockLoad.mockResolvedValue(undefined);
  mockExec.mockResolvedValue(0);
  mockWriteFile.mockResolvedValue(undefined);
  mockMount.current = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([0x00, 0x61, 0x73, 0x6d]), { status: 200 }))
  );
  vi.stubGlobal(
    "URL",
    Object.assign({}, globalThis.URL, {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    })
  );
});

import { transcodeArguments, transcodeVideo } from "@/lib/media/video-compressor";
import type { VideoFileFacts } from "@/lib/media/video-length";

function fakeFile(sizeBytes: number, name = "test.mp4", type = "video/mp4"): File {
  return new File([new ArrayBuffer(sizeBytes)], name, { type });
}

/** Facts of a 20 s 1080p 30 fps phone clip with AAC sound; options change one thing. */
function facts(change: Partial<VideoFileFacts> & { fps?: number } = {}): VideoFileFacts {
  const { fps = 30, ...rest } = change;
  return {
    seconds: 20,
    faststart: true,
    video: { codec: "avc1", profile: 100, level: 40, width: 1080, height: 1920, fps },
    videoTracks: 1,
    audio: "aac",
    audioTracks: 1,
    otherTracks: 0,
    ...rest,
  };
}

function lastArgs(): string[] {
  return mockExec.mock.calls[mockExec.mock.calls.length - 1][0] as string[];
}

function after(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
}

describe("transcodeArguments", () => {
  it("remuxes by copying the first video and sound streams into a faststart MP4", () => {
    expect(transcodeArguments("remuxed", facts())).toEqual([
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-map_metadata",
      "-1",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
    ]);
  });

  it("converts with sharper settings: H.264 High 4.0, CRF 23 capped at 3 Mbps, 2 s keyframes", () => {
    const args = transcodeArguments("converted", facts());
    expect(after(args, "-c:v")).toBe("libx264");
    expect(after(args, "-profile:v")).toBe("high");
    expect(after(args, "-level")).toBe("4.0");
    expect(after(args, "-pix_fmt")).toBe("yuv420p");
    expect(after(args, "-crf")).toBe("23");
    expect(after(args, "-maxrate")).toBe("3000k");
    expect(after(args, "-bufsize")).toBe("6000k");
    expect(after(args, "-g")).toBe("60");
    expect(after(args, "-movflags")).toBe("+faststart");
    expect(args).not.toContain("-b:v");
    expect(args).not.toContain("baseline");
    const filter = after(args, "-vf")!;
    expect(filter).toContain("1280");
    expect(filter).toContain("720");
    expect(filter).toContain("pad=");
  });

  it("shrinks the rate buffer for short clips so the average stays within 4 Mbps", () => {
    expect(after(transcodeArguments("converted", facts({ seconds: 1 })), "-bufsize")).toBe("500k");
    expect(after(transcodeArguments("converted", facts({ seconds: 4 })), "-bufsize")).toBe("2000k");
    expect(after(transcodeArguments("converted", facts({ seconds: 90 })), "-bufsize")).toBe(
      "6000k"
    );
    expect(after(transcodeArguments("converted", null), "-bufsize")).toBe("6000k");
  });

  it("uses superfast up to 30 s and ultrafast for longer or unreadable clips", () => {
    expect(after(transcodeArguments("converted", facts({ seconds: 30 })), "-preset")).toBe(
      "superfast"
    );
    expect(after(transcodeArguments("converted", facts({ seconds: 31 })), "-preset")).toBe(
      "ultrafast"
    );
    expect(after(transcodeArguments("converted", null), "-preset")).toBe("ultrafast");
  });

  it("drops to 30 fps only when the source is faster or its rate is unknown", () => {
    expect(after(transcodeArguments("converted", facts({ fps: 29.97 })), "-vf")).toMatch(/^scale=/);
    expect(after(transcodeArguments("converted", facts({ fps: 60 })), "-vf")).toMatch(
      /^fps=30,scale=/
    );
    expect(after(transcodeArguments("converted", null), "-vf")).toMatch(/^fps=30,scale=/);
  });

  it("copies AAC sound and encodes any other sound as AAC 128 kbps", () => {
    const copied = transcodeArguments("converted", facts());
    expect(after(copied, "-c:a")).toBe("copy");
    expect(copied).not.toContain("-b:a");
    for (const other of [facts({ audio: "other" }), facts({ audio: "none" }), null]) {
      const args = transcodeArguments("converted", other);
      expect(after(args, "-c:a")).toBe("aac");
      expect(after(args, "-b:a")).toBe("128k");
    }
  });
});

describe("transcodeVideo", () => {
  it("returns a new MP4 file from the encoder output", async () => {
    const output = await transcodeVideo(fakeFile(3_000_000, "clip.mov", "video/quicktime"), {
      mode: "converted",
      facts: facts(),
    });
    expect(output.type).toBe("video/mp4");
    expect(output.name).toBe("clip.mp4");
    expect(output.size).toBe(500_000);
    const args = lastArgs();
    expect(args.slice(0, 2)).toEqual(["-i", "input.mov"]);
    expect(args.slice(-2)).toEqual(["-y", "output.mp4"]);
  });

  it("passes the remux arguments to the encoder", async () => {
    await transcodeVideo(fakeFile(10), { mode: "remuxed", facts: facts() });
    expect(after(lastArgs(), "-c")).toBe("copy");
  });

  it("throws when the encoder fails, or produces nothing", async () => {
    mockExec.mockResolvedValueOnce(1);
    await expect(transcodeVideo(fakeFile(10), { mode: "converted", facts: null })).rejects.toThrow(
      "exited with code 1"
    );
    mockReadFile.mockResolvedValueOnce(new Uint8Array(0));
    await expect(transcodeVideo(fakeFile(10), { mode: "converted", facts: null })).rejects.toThrow(
      "empty file"
    );
  });

  it("reports progress", async () => {
    const onProgress = vi.fn();
    mockOn.mockImplementationOnce((_event: string, handler: (p: { progress: number }) => void) =>
      handler({ progress: 0.42 })
    );
    await transcodeVideo(fakeFile(10), { mode: "converted", facts: null, onProgress });
    expect(onProgress).toHaveBeenCalledWith(42);
  });

  it("throws AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      transcodeVideo(fakeFile(10), { mode: "converted", facts: null, signal: controller.signal })
    ).rejects.toThrow("Compression aborted");
  });

  it("mounts a large phone original for the encoder instead of copying it into memory", async () => {
    mockMount.current = vi.fn(async () => true);
    const file = fakeFile(10, "phone.mov", "video/quicktime");
    Object.defineProperty(file, "size", { value: 250 * 1024 * 1024 });
    await transcodeVideo(file, { mode: "converted", facts: null });
    expect(mockMount.current).toHaveBeenCalledWith(
      "WORKERFS",
      { blobs: [{ name: "input.mov", data: file }] },
      "/upload"
    );
    expect(mockWriteFile).not.toHaveBeenCalledWith("input.mov", expect.anything());
    expect(after(lastArgs(), "-i")).toBe("/upload/input.mov");
  });

  it("does not copy an original over 50 MB into memory when mounting is unavailable", async () => {
    const file = fakeFile(10, "phone.mov", "video/quicktime");
    Object.defineProperty(file, "size", { value: 60 * 1024 * 1024 });
    await expect(transcodeVideo(file, { mode: "converted", facts: null })).rejects.toThrow();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("LIM-APP-video-copy-size: without mounting, copies an original of exactly 50 MB into memory, not one byte more", async () => {
    for (const [bytes, copied] of [
      [50 * 1024 * 1024, true],
      [50 * 1024 * 1024 + 1, false],
    ] as const) {
      mockWriteFile.mockClear();
      const file = fakeFile(10, "phone.mov", "video/quicktime");
      Object.defineProperty(file, "size", { value: bytes });
      await transcodeVideo(file, { mode: "converted", facts: null }).catch(() => undefined);
      if (copied) expect(mockWriteFile).toHaveBeenCalledWith("input.mov", expect.anything());
      else expect(mockWriteFile).not.toHaveBeenCalled();
    }
  });

  it("unmounts the picked file and stops the encoder when it fails", async () => {
    mockMount.current = vi.fn(async () => true);
    mockExec.mockResolvedValueOnce(1);
    await expect(
      transcodeVideo(fakeFile(10, "phone.mov", "video/quicktime"), {
        mode: "converted",
        facts: null,
      })
    ).rejects.toThrow();
    expect(mockUnmount).toHaveBeenCalledWith("/upload");
    expect(mockTerminate).toHaveBeenCalled();
  });
});
