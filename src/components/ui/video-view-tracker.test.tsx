import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { VideoViewTracker } from "./video-view-tracker";

const id = "00000000-0000-0000-0000-000000000123";
const fetchMock = vi.fn();

let now = Date.now();
function watch(video: HTMLVideoElement, seconds = 9) {
  Object.defineProperty(video, "paused", { configurable: true, value: false });
  Object.defineProperty(video, "duration", { configurable: true, value: 10 });
  fireEvent.playing(video);
  for (let i = 0; i < seconds; i++) {
    now += 1000;
    video.currentTime += 1;
    fireEvent.timeUpdate(video);
  }
}

function renderVideo(props = {}) {
  const result = render(
    <VideoViewTracker targetId={id} targetType="listing" {...props}>
      <video src="/test.mp4" />
    </VideoViewTracker>
  );
  return { ...result, video: result.container.querySelector("video")! };
}

describe("VideoViewTracker", () => {
  beforeEach(() => {
    now += 31 * 60 * 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    localStorage.clear();
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ recorded: true }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requires 90% of short videos and deduplicates buffering, pause and replay", async () => {
    const onRecorded = vi.fn();
    const { video } = renderVideo({ onRecorded });
    watch(video, 8);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.waiting(video);
    watch(video, 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.pause(video);
    watch(video);
    fireEvent.ended(video);
    video.currentTime = 0;
    watch(video);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
  });

  it("shares qualified views across remounts and counts a new session after inactivity", () => {
    const first = renderVideo();
    watch(first.video);
    first.unmount();
    const second = renderVideo();
    watch(second.video);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 31 * 60 * 1000;
    watch(second.video);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies[0].playbackId).not.toBe(bodies[1].playbackId);
  });

  it("does not credit hidden playback or seeking", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    const { video } = renderVideo();
    watch(video);
    expect(fetchMock).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    fireEvent.seeking(video);
    video.currentTime = 90;
    now += 1000;
    fireEvent.timeUpdate(video);
    expect(fetchMock).not.toHaveBeenCalled();
    watch(video);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["listing", "listing"],
    ["mzansi-business", "business"],
    ["tourism-events", "promotion"],
  ])("identifies %s showroom and feed cards", (path, targetType) => {
    const { video } = renderVideo({
      targetId: undefined,
      targetType: undefined,
      href: `/${path}/${id}`,
    });
    watch(video);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ targetId: id, targetType });
  });

  it("does not count review previews or placeholder cards", () => {
    watch(renderVideo({ enabled: false }).video);
    watch(renderVideo({ targetId: undefined, targetType: undefined, href: "#" }).video);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires 30 seconds for long videos", () => {
    const { video } = renderVideo();
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    Object.defineProperty(video, "duration", { configurable: true, value: 120 });
    fireEvent.playing(video);
    for (let i = 1; i <= 30; i++) {
      now += 1000;
      video.currentTime = i;
      fireEvent.timeUpdate(video);
      expect(fetchMock).toHaveBeenCalledTimes(i === 30 ? 1 : 0);
    }
  });
});
