import { describe, it, expect, beforeEach } from "vitest";
import { reducer } from "@/hooks/use-toast";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Helper to call reducer without fighting complex Toast type unions. */
const r = reducer as (state: any, action: any) => any;

function addToast(state: any, id: string, extra: Record<string, unknown> = {}) {
  return r(state, { type: "ADD_TOAST", toast: { id, open: true, ...extra } });
}

describe("use-toast reducer", () => {
  let state: { toasts: any[] };

  beforeEach(() => {
    state = { toasts: [] };
  });

  it("adds a toast", () => {
    const next = addToast(state, "1", { title: "Hello" });
    expect(next.toasts).toHaveLength(1);
    expect(next.toasts[0].title).toBe("Hello");
  });

  it("enforces TOAST_LIMIT of 3", () => {
    let s: any = state;
    for (let i = 0; i < 5; i++) {
      s = addToast(s, String(i), { title: `Toast ${i}` });
    }
    expect(s.toasts.length).toBeLessThanOrEqual(3);
  });

  it("prepends new toasts", () => {
    let s = addToast(state, "1", { title: "First" });
    s = addToast(s, "2", { title: "Second" });
    expect(s.toasts[0].title).toBe("Second");
  });

  it("updates a toast", () => {
    const s = addToast(state, "1", { title: "Original" });
    const next = r(s, { type: "UPDATE_TOAST", toast: { id: "1", title: "Updated" } });
    expect(next.toasts[0].title).toBe("Updated");
  });

  it("dismisses a specific toast", () => {
    const s = addToast(state, "1", { title: "Hello" });
    const next = r(s, { type: "DISMISS_TOAST", toastId: "1" });
    expect(next.toasts[0].open).toBe(false);
  });

  it("dismisses all toasts when no ID given", () => {
    let s = addToast(state, "1");
    s = addToast(s, "2");
    const next = r(s, { type: "DISMISS_TOAST" });
    expect(next.toasts.every((t: any) => t.open === false)).toBe(true);
  });

  it("removes a specific toast", () => {
    let s = addToast(state, "1");
    s = addToast(s, "2");
    const next = r(s, { type: "REMOVE_TOAST", toastId: "1" });
    expect(next.toasts).toHaveLength(1);
    expect(next.toasts[0].id).toBe("2");
  });

  it("removes all toasts when no ID given", () => {
    let s = addToast(state, "1");
    s = addToast(s, "2");
    const next = r(s, { type: "REMOVE_TOAST" });
    expect(next.toasts).toHaveLength(0);
  });
});
