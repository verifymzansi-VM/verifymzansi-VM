import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetContentViewQueueForTests,
  trackContentView,
  trackContentViewAfterDwell,
} from "./content-views";

const ID = "00000000-0000-4000-8000-000000000123";
const challenge = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/components/engagement/viewer-challenge", () => ({
  obtainViewerIdentifier: challenge,
  RETRY_AFTER_FAILURE_MS: 10 * 60 * 1000,
}));

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

  it("a new browser gets its identifier (one check) and sends once more", async () => {
    challenge.mockClear().mockResolvedValue(true);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, counted: [], needs_challenge: true }),
    });
    const view = trackContentView({ type: "listing", id: ID, source: "page" });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(view).resolves.toBe(true);
    expect(challenge).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
  });

  it("sends only once more, and not at all when the check fails", async () => {
    challenge.mockClear().mockResolvedValue(true);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, counted: [], needs_challenge: true }),
    });
    const view = trackContentView({ type: "listing", id: ID, source: "page" });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(view).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resetContentViewQueueForTests();
    localStorage.clear();
    fetchMock.mockClear();
    challenge.mockClear().mockResolvedValue(false);
    const refused = trackContentView({ type: "business", id: ID, source: "page" });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(refused).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a view the server did not count for a missing check is not kept as sent", async () => {
    challenge.mockClear().mockResolvedValue(false);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, counted: [], needs_challenge: true }),
    });
    const key = `vmz:view:listing:${ID}`;
    const view = trackContentView({ type: "listing", id: ID, source: "page" });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(view).resolves.toBe(false);
    expect(localStorage.getItem(key)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Scrolling back on the same page sends nothing more while the check waits.
    const scrollBack = trackContentView({ type: "listing", id: ID, source: "page" });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(scrollBack).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Once the check may run again (10 minutes), the view is sent again.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 10 * 60 * 1000 + 1);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, counted: [ID] }) });
    const later = trackContentView({ type: "listing", id: ID, source: "page" });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(later).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("the next open of the page (a reload) sends an uncounted view again", async () => {
    challenge.mockClear().mockResolvedValue(false);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, counted: [], needs_challenge: true }),
    });
    await Promise.all([
      trackContentView({ type: "listing", id: ID, source: "page" }),
      vi.advanceTimersByTimeAsync(1100),
    ]);
    resetContentViewQueueForTests(); // a reload: memory is new, storage kept
    const reopened = trackContentView({ type: "listing", id: ID, source: "page" });
    await vi.advanceTimersByTimeAsync(1100);
    await expect(reopened).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

describe("trackContentViewAfterDwell", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    localStorage.clear();
    resetContentViewQueueForTests();
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, counted: [ID] }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a page view only after two seconds visible", async () => {
    const counted = vi.fn();
    trackContentViewAfterDwell({ type: "business", id: ID, source: "page" }, counted);
    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(counted).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the page is left first, and restarts after a hidden tab", async () => {
    const cancel = trackContentViewAfterDwell({ type: "business", id: ID, source: "page" });
    await vi.advanceTimersByTimeAsync(1500);
    cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();

    const visibility = vi.spyOn(document, "visibilityState", "get");
    trackContentViewAfterDwell({ type: "business", id: ID, source: "page" });
    await vi.advanceTimersByTimeAsync(1500);
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
