import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockLoadMessages = vi.fn();
const mockResolveKey = vi.fn();

vi.mock("@/lib/i18n", () => ({
  defaultLocale: "en",
  loadMessages: (...args: unknown[]) => mockLoadMessages(...args),
  resolveKey: (...args: unknown[]) => mockResolveKey(...args),
}));

// Must import AFTER mocks
import { useTranslation, useI18nStore } from "./use-translation";

describe("useTranslation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the Zustand store state between tests
    useI18nStore.setState({ locale: "en", messages: null, isLoading: false });
    mockLoadMessages.mockResolvedValue({ common: { tagline: "South Africa's marketplace" } });
    mockResolveKey.mockImplementation((_msgs: unknown, key: string) => `resolved:${key}`);
  });

  it("returns a t() function that resolves keys", async () => {
    const { result } = renderHook(() => useTranslation());

    // Wait for messages to load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const translated = result.current.t("common.tagline");
    expect(translated).toBe("resolved:common.tagline");
  });

  it("returns key as fallback when messages have not loaded", () => {
    // Ensure messages are null
    useI18nStore.setState({ messages: null, isLoading: true });

    const { result } = renderHook(() => useTranslation());
    expect(result.current.t("some.key")).toBe("some.key");
  });

  it("provides the current locale", () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.locale).toBe("en");
  });

  it("auto-loads messages when not yet loaded", async () => {
    renderHook(() => useTranslation());

    await waitFor(() => {
      expect(mockLoadMessages).toHaveBeenCalledWith("en");
    });
  });
});
