import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { VideoViewTracker } from "./video-view-tracker";

const id = "00000000-0000-0000-0000-000000000123";
const fetchMock = vi.fn();

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
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ recorded: true }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("counts actual playback once across buffering events, then counts a new play", async () => {
    const onRecorded = vi.fn();
    const { video } = renderVideo({ onRecorded });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.play(video);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.playing(video);
    fireEvent.waiting(video);
    fireEvent.playing(video);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.pause(video);
    fireEvent.playing(video);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies[0]).toMatchObject({ targetId: id, targetType: "listing" });
    expect(bodies[0].playbackId).not.toBe(bodies[1].playbackId);
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(2));
  });

  it("counts another visit on the same device", () => {
    const first = renderVideo();
    fireEvent.playing(first.video);
    first.unmount();
    fireEvent.playing(renderVideo().video);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("counts playback again after locking and returning to the app", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    const { video } = renderVideo();
    fireEvent.playing(video);
    visibility.mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    fireEvent.playing(video);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    fireEvent.playing(video);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    fireEvent.playing(video);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ targetId: id, targetType });
  });

  it("does not count review previews or placeholder cards", () => {
    fireEvent.playing(renderVideo({ enabled: false }).video);
    fireEvent.playing(renderVideo({ targetId: undefined, href: "#" }).video);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts replay after the video ends", () => {
    const { video } = renderVideo();
    fireEvent.playing(video);
    fireEvent.ended(video);
    fireEvent.playing(video);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
