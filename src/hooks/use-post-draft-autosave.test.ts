import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/hooks/use-debounce", () => ({
  useDebouncedCallback: (fn: Function, _delay: number) => {
    const wrapper = (...args: unknown[]) => fn(...args);
    wrapper.cancel = vi.fn();
    return wrapper;
  },
}));

vi.mock("@/hooks/use-hydrated", () => ({
  useHydrated: () => true,
}));

const mockSaveDraft = vi.fn();
const mockLoadDraft = vi.fn();
const mockClearDraft = vi.fn();

vi.mock("@/lib/post-drafts/storage", () => ({
  saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
  loadDraft: (...args: unknown[]) => mockLoadDraft(...args),
  clearDraft: (...args: unknown[]) => mockClearDraft(...args),
}));

vi.mock("@/lib/utils/csrf", () => ({
  withCsrfHeaders: (h?: HeadersInit) => new Headers(h),
}));

// Mock fetch globally
const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
vi.stubGlobal("fetch", mockFetch);

import { usePostDraftAutosave } from "./use-post-draft-autosave";

describe("usePostDraftAutosave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadDraft.mockReturnValue(null);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("saves draft to localStorage when save is called", () => {
    const { result } = renderHook(() => usePostDraftAutosave("listing", "user-1", true));

    act(() => {
      result.current.save(1, { title: "Test" });
    });

    expect(mockSaveDraft).toHaveBeenCalledWith("listing", "user-1", 1, { title: "Test" });
  });

  it("does not save when userId is null", () => {
    const { result } = renderHook(() => usePostDraftAutosave("listing", null, true));

    act(() => {
      result.current.save(1, { title: "Test" });
    });

    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("does not save when disabled", () => {
    const { result } = renderHook(() => usePostDraftAutosave("listing", "user-1", false));

    act(() => {
      result.current.save(1, { title: "Test" });
    });

    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("restores draft from localStorage", () => {
    const draft = { v: 1, savedAt: Date.now(), step: 2, data: { title: "Saved" } };
    mockLoadDraft.mockReturnValue(draft);

    const { result } = renderHook(() => usePostDraftAutosave("listing", "user-1", true));

    const restored = result.current.restore();
    expect(restored).toEqual(draft);
    expect(mockLoadDraft).toHaveBeenCalledWith("listing", "user-1");
  });

  it("restores only once per mount", () => {
    mockLoadDraft.mockReturnValue({ v: 1, savedAt: Date.now(), step: 1, data: {} });

    const { result } = renderHook(() => usePostDraftAutosave("listing", "user-1", true));

    result.current.restore();
    const second = result.current.restore();
    expect(second).toBeNull(); // second call returns null
  });

  it("discard clears localStorage and calls server delete", () => {
    const { result } = renderHook(() => usePostDraftAutosave("listing", "user-1", true));

    act(() => {
      result.current.discard();
    });

    expect(mockClearDraft).toHaveBeenCalledWith("listing", "user-1");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/drafts"),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
