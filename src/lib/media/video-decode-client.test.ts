import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("@/lib/media/video-decode-client");
const { canBrowserShowVideo } = await import("./video-decode-client");

/** jsdom never loads media: each test plays the browser's answer on the element. */
function captureVideo() {
  const create = document.createElement.bind(document);
  let video: HTMLVideoElement | null = null;
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const element = create(tag);
    if (tag === "video") video = element as HTMLVideoElement;
    return element;
  }) as typeof document.createElement);
  return () => video!;
}

function setSize(video: HTMLVideoElement, width: number, height: number) {
  Object.defineProperty(video, "videoWidth", { value: width });
  Object.defineProperty(video, "videoHeight", { value: height });
}

describe("canBrowserShowVideo", () => {
  const file = new Blob(["video"], { type: "video/mp4" });

  beforeEach(() => {
    global.URL.createObjectURL = vi.fn(() => "blob:clip");
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("accepts a video that loads with a picture", async () => {
    const video = captureVideo();
    const result = canBrowserShowVideo(file);
    setSize(video(), 1080, 1920);
    video().onloadedmetadata?.(new Event("loadedmetadata"));
    await expect(result).resolves.toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip");
  });

  it("refuses a video that loads with a 0 x 0 picture (e.g. HEVC in Chrome)", async () => {
    const video = captureVideo();
    const result = canBrowserShowVideo(file);
    setSize(video(), 0, 0);
    video().onloadedmetadata?.(new Event("loadedmetadata"));
    await expect(result).resolves.toBe(false);
  });

  it("refuses a video the browser reports as an error", async () => {
    const video = captureVideo();
    const result = canBrowserShowVideo(file);
    video().onerror?.(new Event("error"));
    await expect(result).resolves.toBe(false);
  });

  it("accepts the video when the browser does not answer in time", async () => {
    vi.useFakeTimers();
    captureVideo();
    const result = canBrowserShowVideo(file, 8000);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(result).resolves.toBe(true);
  });
});
