import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { VideoViewTracker } from "./video-view-tracker";
import { resetContentViewQueueForTests } from "@/lib/views/content-views";

const id = "00000000-0000-0000-0000-000000000123";
const fetchMock = vi.fn();

let now = Date.now();

function play(video: HTMLVideoElement, seconds: number, duration = 60) {
  Object.defineProperty(video, "paused", { configurable: true, value: false });
  Object.defineProperty(video, "duration", { configurable: true, value: duration });
  fireEvent.playing(video);
  for (let i = 0; i < seconds; i++) {
    now += 500;
    video.currentTime += 0.5;
    fireEvent.timeUpdate(video);
    now += 500;
    video.currentTime += 0.5;
    fireEvent.timeUpdate(video);
  }
}

async function flushQueue() {
  await act(async () => {
    vi.advanceTimersByTime(1100);
  });
}

function sentEvents() {
  return fetchMock.mock.calls.flatMap((call) => JSON.parse(call[1].body).events);
}

function renderVideo(props = {}) {
  const result = render(
    <VideoViewTracker targetId={id} targetType="listing" surface="showroom:home" {...props}>
      <video src="/test.mp4" />
    </VideoViewTracker>
  );
  return { ...result, video: result.container.querySelector("video")! };
}

describe("VideoViewTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    now += 31 * 60 * 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    localStorage.clear();
    resetContentViewQueueForTests();
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, counted: [id] }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("counts a view after 2 continuous seconds (MRC video standard)", async () => {
    const onRecorded = vi.fn();
    const { video } = renderVideo({ onRecorded });
    play(video, 1);
    await flushQueue();
    expect(fetchMock).not.toHaveBeenCalled();
    play(video, 1);
    await flushQueue();
    expect(sentEvents()).toEqual([
      { type: "listing", id, source: "video", surface: "showroom:home", engaged: false },
    ]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it("restarts the 2 seconds after a pause, stall or seek", async () => {
    const { video } = renderVideo();
    play(video, 1);
    fireEvent.pause(video);
    play(video, 1);
    fireEvent.waiting(video);
    play(video, 1);
    // Browsers update currentTime before firing "seeking".
    video.currentTime = 40;
    fireEvent.seeking(video);
    play(video, 1);
    await flushQueue();
    expect(fetchMock).not.toHaveBeenCalled();
    play(video, 1);
    await flushQueue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not credit playback in a hidden tab", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    const { video } = renderVideo();
    play(video, 5);
    await flushQueue();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts a short video once 97% of it has played", async () => {
    const { video } = renderVideo();
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    Object.defineProperty(video, "duration", { configurable: true, value: 1.5 });
    fireEvent.playing(video);
    now += 1000;
    video.currentTime = 1;
    fireEvent.timeUpdate(video);
    await flushQueue();
    expect(fetchMock).not.toHaveBeenCalled();
    now += 500;
    video.currentTime = 1.5;
    fireEvent.ended(video);
    await flushQueue();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends one engaged signal after 30 seconds, and one view per 30 minutes", async () => {
    const first = renderVideo();
    play(first.video, 31, 120);
    await flushQueue();
    const events = sentEvents();
    expect(events.filter((event) => !event.engaged)).toHaveLength(1);
    expect(events.filter((event) => event.engaged)).toHaveLength(1);
    first.unmount();

    const again = renderVideo();
    play(again.video, 31, 120);
    await flushQueue();
    expect(sentEvents()).toHaveLength(2);

    now += 31 * 60 * 1000;
    play(again.video, 3, 120);
    await flushQueue();
    expect(sentEvents()).toHaveLength(3);
  });

  it.each([
    ["listing", "listing"],
    ["mzansi-business", "business"],
    ["tourism-events", "promotion"],
  ])("identifies %s cards from their link", async (path, type) => {
    const { video } = renderVideo({
      targetId: undefined,
      targetType: undefined,
      href: `/${path}/${id}`,
    });
    play(video, 2);
    await flushQueue();
    expect(sentEvents()[0]).toMatchObject({ id, type });
  });

  it("uses the explicit target over an ambiguous tourism link", async () => {
    const { video } = renderVideo({
      targetId: id,
      targetType: "business",
      href: `/tourism-events/${id}`,
    });
    play(video, 2);
    await flushQueue();
    expect(sentEvents()[0]).toMatchObject({ id, type: "business" });
  });

  it("does not count review previews or placeholder cards", async () => {
    play(renderVideo({ enabled: false }).video, 3);
    play(renderVideo({ targetId: undefined, targetType: undefined, href: "#" }).video, 3);
    await flushQueue();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
