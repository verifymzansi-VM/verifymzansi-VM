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

vi.mock("lucide-react", () => {
  const icon = (name: string) =>
    function Icon(props: React.SVGProps<SVGSVGElement>) {
      return <svg data-testid={`${name}-icon`} {...props} />;
    };
  return {
    Check: icon("check"),
    Copy: icon("copy"),
    Download: icon("download"),
    Ellipsis: icon("ellipsis"),
    EllipsisVertical: icon("ellipsis-vertical"),
    ExternalLink: icon("external-link"),
    Share: icon("share"),
    SquarePlus: icon("square-plus"),
    X: icon("close"),
  };
});

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(
        React.Children.only(children) as React.ReactElement<Record<string, unknown>>,
        props as Record<string, unknown>
      );
    }

    return <button {...props}>{children}</button>;
  },
}));

vi.mock("@/lib/supabase/playwright-mode", () => ({
  isPlaywrightTestMode: mockIsPlaywrightTestMode,
}));

import { PwaInstallPrompt } from "./pwa-install-prompt";
import { resetInstallPromptStore } from "@/lib/pwa/install-prompt-store";

describe("PwaInstallPrompt", () => {
  let currentPath = "/advertise";
  let standaloneMode = false;

  beforeEach(() => {
    cleanup();
    resetInstallPromptStore();
    vi.restoreAllMocks();
    vi.clearAllMocks();

    currentPath = "/advertise";
    standaloneMode = false;

    mockUsePathname.mockImplementation(() => currentPath);
    mockIsPlaywrightTestMode.mockReturnValue(false);

    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 14)",
    });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "Linux armv8l",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 0,
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
    vi.unstubAllEnvs();
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

    const helpButton = await screen.findByRole("button", { name: "Install" });
    fireEvent.click(helpButton);

    expect(await screen.findByRole("dialog", { name: "Install on iPhone" })).toBeTruthy();
    expect(screen.getByText("Tap Share")).toBeTruthy();
    expect(screen.getByText("Tap Add to Home Screen")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();

    // Close via the X button
    fireEvent.click(screen.getByRole("button", { name: "Close install instructions" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Install on iPhone" })).toBeNull();
    });

    // Re-open and close via "Got it"
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(await screen.findByRole("dialog", { name: "Install on iPhone" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Install on iPhone" })).toBeNull();
    });
  });

  it("tells WhatsApp in-app browser visitors to open their real browser", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 WhatsApp/2.24",
    });

    render(<PwaInstallPrompt />);

    expect(await screen.findByText("Open in your browser to install")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(await screen.findByRole("dialog", { name: "Open in your browser" })).toBeTruthy();
    expect(screen.getAllByText("Open in Chrome").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open in Chrome" }).getAttribute("href")).toMatch(
      /^intent:\/\/localhost(:\d+)?\/install#Intent;scheme=https?;package=com\.android\.chrome;/
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("shows the prompt again once a dismissal is older than 30 days", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) =>
      key === "pwa-prompt-dismissed" ? String(thirtyOneDaysAgo) : null
    );

    render(<PwaInstallPrompt />);

    expect(await screen.findByRole("button", { name: "Install" })).toBeTruthy();
  });

  it("does not render once the app runs from the home screen", () => {
    standaloneMode = true;
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });

    render(<PwaInstallPrompt />);

    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("shows iOS install help for iPadOS desktop-mode Safari", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });

    render(<PwaInstallPrompt />);

    expect(await screen.findByRole("button", { name: "Install" })).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("waits until the home hero has been scrolled past before showing the prompt", async () => {
    currentPath = "/";
    render(<PwaInstallPrompt />);

    const beforeInstallPromptEvent = new Event("beforeinstallprompt");
    Object.assign(beforeInstallPromptEvent, {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });

    await act(async () => {
      window.dispatchEvent(beforeInstallPromptEvent);
    });

    expect(screen.queryByText("Install App")).toBeNull();

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 420,
    });

    await act(async () => {
      fireEvent.scroll(window);
    });

    expect(await screen.findByText("Install App")).toBeTruthy();
  });

  it.each([
    "/login",
    "/verification",
    "/error",
    "/mzansi-market",
    "/mzansi-business",
    "/tourism-events",
    "/install",
    "/listing/0b8f8c1e-3f8f-4c1e-9d2a-0f3c2b1a9e7d",
    "/billing/checkout",
    "/post/create",
    "/dashboard",
  ])(
    "suppresses rendering on blocked route %s even when iOS fallback conditions match",
    (blockedPath) => {
      currentPath = blockedPath;

      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      });

      render(<PwaInstallPrompt />);

      expect(screen.queryByText("Install App")).toBeNull();
      expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    }
  );

  it("treats saying no in Chrome's dialog as closing the banner", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);
    render(<PwaInstallPrompt />);

    const beforeInstallPromptEvent = new Event("beforeinstallprompt");
    Object.assign(beforeInstallPromptEvent, {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });
    await act(async () => {
      window.dispatchEvent(beforeInstallPromptEvent);
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    });

    await waitFor(() => expect(screen.queryByText("Install App")).toBeNull());
    expect(setItemSpy).toHaveBeenCalledWith("pwa-prompt-dismissed", expect.stringMatching(/^\d+$/));
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
    expect(setItemSpy).toHaveBeenCalledWith("pwa-prompt-dismissed", expect.stringMatching(/^\d+$/));
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
    expect(setItemSpy).toHaveBeenCalledWith("pwa-prompt-dismissed", expect.stringMatching(/^\d+$/));
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

  it("closes iOS help dialog when Escape key is pressed", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });

    render(<PwaInstallPrompt />);

    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    expect(await screen.findByRole("dialog", { name: "Install on iPhone" })).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Install on iPhone" })).toBeNull();
    });
  });

  it("closes iOS help dialog when backdrop is clicked", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });

    render(<PwaInstallPrompt />);

    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    const dialog = await screen.findByRole("dialog", { name: "Install on iPhone" });
    expect(dialog).toBeTruthy();

    // Click on the backdrop (presentation wrapper behind the dialog)
    const backdrop = dialog.parentElement!;
    fireEvent.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Install on iPhone" })).toBeNull();
    });
  });
});
