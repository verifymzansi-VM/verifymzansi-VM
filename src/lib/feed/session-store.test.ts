import { describe, expect, it, vi } from "vitest";
import { createFeedSessionStore } from "./session-store";
import type { FeedSession } from "./session";

const session: FeedSession = {
  v: 1,
  id: "test-feed",
  createdAt: 1,
  source: { kind: "direct", label: "Test" },
  returnUrl: null,
  refs: [],
  nextPage: null,
  directLoaded: false,
  terminal: null,
};

describe("feed browser storage subscription", () => {
  it("does not read browser storage during server rendering or snapshot reads", () => {
    const initialize = vi.fn(() => ({ session, notice: null }));
    const store = createFeedSessionStore(initialize);
    expect(store.getServerSnapshot()).toEqual({ session: null, notice: null });
    expect(store.getSnapshot()).toBe(store.getServerSnapshot());
    expect(initialize).not.toHaveBeenCalled();
  });

  it("creates one session across a Strict Mode unsubscribe/resubscribe", () => {
    const initialize = vi.fn(() => ({ session, notice: "expired" as const }));
    const store = createFeedSessionStore(initialize);
    const first = vi.fn();
    const unsubscribe = store.subscribe(first);
    expect(first).toHaveBeenCalledTimes(1);
    unsubscribe();
    const snapshot = store.getSnapshot();
    const second = vi.fn();
    store.subscribe(second);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(snapshot);
    store.setSession({ ...session, terminal: "exhausted" });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().notice).toBe("expired");
    expect(store.getServerSnapshot().session).toBeNull();
  });
});
