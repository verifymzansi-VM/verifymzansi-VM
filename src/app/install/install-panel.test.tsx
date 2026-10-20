/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallPanel } from "./install-panel";
import { resetInstallPromptStore } from "@/lib/pwa/install-prompt-store";

let standaloneMode = false;

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value });
}

describe("InstallPanel", () => {
  beforeEach(() => {
    standaloneMode = false;
    resetInstallPromptStore();
    setUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile");
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "Linux armv8l",
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", { configurable: true, value: 0 });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: standaloneMode,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("offers the browser install prompt on Android when available", async () => {
    render(<InstallPanel />);
    expect(screen.getAllByText("Tap Install app or Add to Home screen").length).toBeGreaterThan(1);

    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event("beforeinstallprompt");
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });
    await act(async () => {
      window.dispatchEvent(event);
    });

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  });

  it("shows Share → Add to Home Screen on iPhone", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    render(<InstallPanel />);
    expect(screen.getByRole("heading", { name: "Install on iPhone" })).toBeTruthy();
    expect(screen.getAllByText("Tap Share").length).toBeGreaterThan(0);
  });

  it("sends in-app browser visitors to their real browser", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) [FBAN/FBIOS;FBAV/450]");
    render(<InstallPanel />);
    expect(screen.getByRole("heading", { name: "Open in your browser" })).toBeTruthy();
    expect(screen.getByText("Tap Open in Safari or Open in browser")).toBeTruthy();
  });

  it("confirms when already installed", () => {
    standaloneMode = true;
    render(<InstallPanel />);
    expect(screen.getByRole("heading", { name: "You're using the app" })).toBeTruthy();
  });
});
