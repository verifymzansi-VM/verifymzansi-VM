import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetContentViewQueueForTests, trackContentView } from "./content-views";

const ID = "00000000-0000-4000-8000-000000000123";

describe("trackContentView", () => {
  const fetchMock = vi.fn();
  const beaconMock = vi.fn(() => true);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    localStorage.clear();
    resetContentViewQueueForTests();
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, counted: [ID] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beaconMock });
    beaconMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends once per post per 30 minutes and credits the count once", async () => {
    const first = trackContentView({ type: "listing", id: ID, source: "page" });
    const repeat = trackContentView({ type: "listing", id: ID, source: "video" });
    await vi.advanceTimersByTimeAsync(1100);

    await expect(first).resolves.toBe(true);
    await expect(repeat).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).events).toHaveLength(1);
  });

  it("sends at once when the page is hidden (app switch, screen lock)", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    void trackContentView({ type: "business", id: ID, source: "page", surface: "detail" });
    expect(beaconMock).not.toHaveBeenCalled();

    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(beaconMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forgets the send after a failure so a later play can retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await Promise.all([
      trackContentView({ type: "listing", id: ID, source: "page" }),
      vi.advanceTimersByTimeAsync(1100),
    ]);

    const retry = trackContentView({ type: "listing", id: ID, source: "page" });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(retry).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
