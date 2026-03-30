import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, loadDraft, saveDraft } from "@/lib/post-drafts/storage";

describe("post-drafts storage", () => {
  const userId = "user-123";

  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and loads a listing draft envelope", () => {
    saveDraft("listing", userId, 1, {
      title: "Bike for sale",
      category: "vehicles",
    });

    const loaded = loadDraft<{ title: string; category: string }>("listing", userId);

    expect(loaded).toBeTruthy();
    expect(loaded?.step).toBe(1);
    expect(loaded?.data.title).toBe("Bike for sale");
    expect(loaded?.data.category).toBe("vehicles");
  });

  it("clears a saved draft", () => {
    saveDraft("promotion", userId, 2, { title: "Weekend event" });
    clearDraft("promotion", userId);

    const loaded = loadDraft<{ title: string }>("promotion", userId);
    expect(loaded).toBeNull();
  });

  it("drops expired drafts", () => {
    const key = `vm-draft:business:${userId}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        v: 1,
        savedAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
        step: 1,
        data: { businessName: "Old draft" },
      })
    );

    const loaded = loadDraft<{ businessName: string }>("business", userId);
    expect(loaded).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("drops incompatible draft versions", () => {
    const key = `vm-draft:listing:${userId}`;
    localStorage.setItem(
      key,
      JSON.stringify({
        v: 999,
        savedAt: Date.now(),
        step: 0,
        data: { title: "stale" },
      })
    );

    const loaded = loadDraft<{ title: string }>("listing", userId);
    expect(loaded).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("handles malformed draft payloads", () => {
    const key = `vm-draft:promotion:${userId}`;
    localStorage.setItem(key, "{bad-json");

    const loaded = loadDraft<{ title: string }>("promotion", userId);
    expect(loaded).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });
});
