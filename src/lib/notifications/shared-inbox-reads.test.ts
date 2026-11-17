import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEADS_UNREAD_URL,
  READ_TIMEOUT_MS,
  sharedInboxRead,
  subscribeSharedPoll,
} from "./shared-inbox-reads";

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
      signal: expect.any(AbortSignal),
    });
    first.resolve(Response.json({ unreadCount: 2 }));
    await expect(a).resolves.toEqual({ ok: true, status: 200, data: { unreadCount: 2 } });

    // Nothing is kept: a later caller (a realtime signal) reads again.
    await expect(sharedInboxRead(LEADS_UNREAD_URL)).resolves.toMatchObject({
      data: { unreadCount: 3 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives a change signal that arrives during a read one more read that starts after it", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);

    const load = sharedInboxRead(LEADS_UNREAD_URL);
    const signalA = sharedInboxRead(LEADS_UNREAD_URL, { fresh: true });
    const signalB = sharedInboxRead(LEADS_UNREAD_URL, { fresh: true });
    expect(signalA).toBe(signalB);
    // Still one request until the first settles.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    first.resolve(Response.json({ unreadCount: 1 }));
    await expect(load).resolves.toMatchObject({ data: { unreadCount: 1 } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    second.resolve(Response.json({ unreadCount: 2 }));
    await expect(signalA).resolves.toMatchObject({ data: { unreadCount: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels a read that never settles, so later refreshes are not blocked", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) =>
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("The operation was aborted.", "AbortError"))
              )
            )
        )
        .mockResolvedValueOnce(Response.json({ unreadCount: 4 }));
      vi.stubGlobal("fetch", fetchMock);

      const stuck = sharedInboxRead(LEADS_UNREAD_URL);
      const stuckResult = expect(stuck).rejects.toThrow(/abort/i);
      // A change signal meanwhile waits for the stuck read, then reads afresh.
      const signal = sharedInboxRead(LEADS_UNREAD_URL, { fresh: true });
      await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
      await stuckResult;
      await expect(signal).resolves.toMatchObject({ data: { unreadCount: 4 } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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
