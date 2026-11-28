import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPickedVideoLength, NO_VIDEO_TRACK_MESSAGE } from "./video-length-client";

/** jsdom never loads media: each test plays the browser's answer on the element. */
async function pickUnreadable(width: number, height: number, event: "loadedmetadata" | "error") {
  const create = document.createElement.bind(document);
  let video: HTMLVideoElement | null = null;
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const element = create(tag);
    if (tag === "video") video = element as HTMLVideoElement;
    return element;
  }) as typeof document.createElement);
  // Not a readable MP4 header (an audio file named .mp4 has no video track to measure).
  const file = new File([new Uint8Array(64)], "song.mp4", { type: "video/mp4" });
  const result = checkPickedVideoLength(file, 120);
  await vi.waitFor(() => expect(video).not.toBeNull());
  Object.defineProperty(video!, "videoWidth", { value: width });
  Object.defineProperty(video!, "videoHeight", { value: height });
  if (event === "loadedmetadata") video!.onloadedmetadata?.(new Event(event));
  else video!.onerror?.(new Event(event));
  return result;
}

describe("checkPickedVideoLength: a picked file with no picture", () => {
  beforeEach(() => {
    global.URL.createObjectURL = vi.fn(() => "blob:clip");
    global.URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("refuses a file the browser loads with no width or height", async () => {
    await expect(pickUnreadable(0, 0, "loadedmetadata")).resolves.toBe(NO_VIDEO_TRACK_MESSAGE);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip");
  });

  it("accepts an unreadable file the browser shows with a picture", async () => {
    await expect(pickUnreadable(720, 1280, "loadedmetadata")).resolves.toBeNull();
  });

  it("leaves it to Submit when the browser cannot load the file", async () => {
    await expect(pickUnreadable(0, 0, "error")).resolves.toBeNull();
  });
});
