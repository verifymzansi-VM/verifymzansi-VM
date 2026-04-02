/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUsePathname, mockIsPlaywrightTestMode } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
  mockIsPlaywrightTestMode: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
}));

vi.mock("lucide-react", () => ({
  Download: (props: React.SVGProps<SVGSVGElement>) => (
    <svg data-testid="download-icon" {...props} />
  ),
  X: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="close-icon" {...props} />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/lib/supabase/playwright-mode", () => ({
  isPlaywrightTestMode: mockIsPlaywrightTestMode,
}));

import { PwaInstallPrompt } from "./pwa-install-prompt";

describe("PwaInstallPrompt", () => {
  let currentPath = "/";
  let standaloneMode = false;

  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();

    currentPath = "/";
    standaloneMode = false;

    mockUsePathname.mockImplementation(() => currentPath);
    mockIsPlaywrightTestMode.mockReturnValue(false);

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 14)",
    });

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => null);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);

    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: standaloneMode,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("renders for beforeinstallprompt and hides after an accepted install choice", async () => {
    render(<PwaInstallPrompt />);

    const prompt = vi.fn().mockResolvedValue(undefined);
    const beforeInstallPromptEvent = new Event("beforeinstallprompt");

    Object.assign(beforeInstallPromptEvent, {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });

    await act(async () => {
      window.dispatchEvent(beforeInstallPromptEvent);
    });

    expect(await screen.findByText("Install App")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });

    await waitFor(() => {
      expect(prompt).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByText("Install App")).toBeNull();
    });
  });

  it("shows iOS install help and allows closing via close button and Got it", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });

    render(<PwaInstallPrompt />);

    const helpButton = await screen.findByRole("button", { name: "How To Install" });
    fireEvent.click(helpButton);

    expect(await screen.findByRole("dialog", { name: "Install on iPhone" })).toBeTruthy();
    expect(screen.getByText("Tap the Share button in Safari.")).toBeTruthy();

    // Close via the X button
    fireEvent.click(screen.getByRole("button", { name: "Close install instructions" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Install on iPhone" })).toBeNull();
    });

    // Re-open and close via "Got it"
    fireEvent.click(screen.getByRole("button", { name: "How To Install" }));
    expect(await screen.findByRole("dialog", { name: "Install on iPhone" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Install on iPhone" })).toBeNull();
    });
  });

  it("suppresses rendering when the prompt was previously dismissed", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });

    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) =>
      key === "pwa-prompt-dismissed" ? "true" : null
    );

    render(<PwaInstallPrompt />);

    expect(screen.queryByText("Install App")).toBeNull();
    expect(screen.queryByRole("button", { name: "How To Install" })).toBeNull();
  });

  it("suppresses rendering on blocked auth routes even when iOS fallback conditions match", () => {
    currentPath = "/login";

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });

    render(<PwaInstallPrompt />);

    expect(screen.queryByText("Install App")).toBeNull();
    expect(screen.queryByRole("button", { name: "How To Install" })).toBeNull();
  });

  it("keeps UI usable when userChoice rejects", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);

    render(<PwaInstallPrompt />);

    const prompt = vi.fn().mockResolvedValue(undefined);
    let rejectUserChoice: ((reason?: unknown) => void) | null = null;
    const userChoicePromise = new Promise<{ outcome: "accepted" | "dismissed"; platform: string }>(
      (_, reject) => {
        rejectUserChoice = reject;
      }
    );

    const beforeInstallPromptEvent = new Event("beforeinstallprompt");
    Object.assign(beforeInstallPromptEvent, {
      prompt,
      userChoice: userChoicePromise,
    });

    await act(async () => {
      window.dispatchEvent(beforeInstallPromptEvent);
    });

    expect(await screen.findByRole("button", { name: "Install" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
      rejectUserChoice!(new Error("userChoice failed"));
    });

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));

    // Prompt must remain usable after rejection
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText("Dismiss install prompt"));
    await waitFor(() => expect(screen.queryByText("Install App")).toBeNull());
    expect(setItemSpy).toHaveBeenCalledWith("pwa-prompt-dismissed", "true");
  });

  it("survives storage failures without crashing", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    render(<PwaInstallPrompt />);

    const prompt = vi.fn().mockRejectedValue(new Error("prompt failed"));
    const beforeInstallPromptEvent = new Event("beforeinstallprompt");

    Object.assign(beforeInstallPromptEvent, {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });

    await act(async () => {
      window.dispatchEvent(beforeInstallPromptEvent);
    });

    expect(await screen.findByRole("button", { name: "Install" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText("Dismiss install prompt"));
    await waitFor(() => expect(screen.queryByText("Install App")).toBeNull());
    expect(setItemSpy).toHaveBeenCalledWith("pwa-prompt-dismissed", "true");
  });

  it("cleans up visible prompt when suppression flips true after prompt is shown", async () => {
    const { rerender } = render(<PwaInstallPrompt />);

    const beforeInstallPromptEvent = new Event("beforeinstallprompt");
    Object.assign(beforeInstallPromptEvent, {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });

    await act(async () => {
      window.dispatchEvent(beforeInstallPromptEvent);
    });

    expect(await screen.findByText("Install App")).toBeTruthy();

    // Simulate navigation to a blocked auth route
    currentPath = "/login";
    rerender(<PwaInstallPrompt />);

    await waitFor(() => {
      expect(screen.queryByText("Install App")).toBeNull();
    });
  });
});
