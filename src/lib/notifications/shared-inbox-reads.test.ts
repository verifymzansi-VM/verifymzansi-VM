import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEADS_UNREAD_URL, sharedInboxRead, subscribeSharedPoll } from "./shared-inbox-reads";

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

describe("sharedInboxRead", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("joins the request in flight and starts a fresh one once it settles", async () => {
    const first = deferredResponse();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(Response.json({ unreadCount: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    const a = sharedInboxRead(LEADS_UNREAD_URL);
    const b = sharedInboxRead(LEADS_UNREAD_URL);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(LEADS_UNREAD_URL, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    first.resolve(Response.json({ unreadCount: 2 }));
    await expect(a).resolves.toEqual({ ok: true, status: 200, data: { unreadCount: 2 } });

    // Nothing is kept: a later caller (a realtime signal) reads again.
    await expect(sharedInboxRead(LEADS_UNREAD_URL)).resolves.toMatchObject({
      data: { unreadCount: 3 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports refusals and unreadable bodies as not ok, and recovers after a network error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("no", { status: 401 }))
      .mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(Response.json({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sharedInboxRead("/x")).resolves.toEqual({ ok: false, status: 401, data: null });
    await expect(sharedInboxRead("/x")).resolves.toEqual({ ok: false, status: 200, data: null });
    await expect(sharedInboxRead("/x")).rejects.toThrow("offline");
    await expect(sharedInboxRead("/x")).resolves.toMatchObject({ ok: true });
  });
});

describe("subscribeSharedPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => vi.useRealTimers());

  it("runs every subscriber from one timer, only while visible, and stops with the last one", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeSharedPoll("test", 60_000, a);
    const stopB = subscribeSharedPoll("test", 60_000, b);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    vi.advanceTimersByTime(120_000);
    expect(a).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    window.dispatchEvent(new Event("focus"));
    expect(a).toHaveBeenCalledTimes(2);

    stopA();
    vi.advanceTimersByTime(60_000);
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([2, 3]);

    stopB();
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event("focus"));
    expect(b).toHaveBeenCalledTimes(3);
    setIntervalSpy.mockRestore();
  });
});
