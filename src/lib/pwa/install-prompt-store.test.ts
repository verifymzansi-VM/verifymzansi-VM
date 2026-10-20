/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

function fakePrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
  return event;
}

async function loadStore() {
  vi.resetModules();
  return import("./install-prompt-store");
}

describe("install prompt store", () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__vmInstallPrompt = undefined;
  });

  it("picks up an event the inline script caught before the app loaded", async () => {
    const early = fakePrompt();
    (window as unknown as Record<string, unknown>).__vmInstallPrompt = early;

    const store = await loadStore();
    store.subscribeInstallPrompt(() => {});

    expect(store.getInstallPromptState().prompt).toBe(early);
  });

  it("captures later events, suppresses Chrome's own infobar and notifies readers", async () => {
    const store = await loadStore();
    const listener = vi.fn();
    store.subscribeInstallPrompt(listener);

    const event = fakePrompt();
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(store.getInstallPromptState().prompt).toBe(event);
    expect(listener).toHaveBeenCalled();
  });

  it("uses a prompt once and reports the choice", async () => {
    const store = await loadStore();
    store.subscribeInstallPrompt(() => {});
    window.dispatchEvent(fakePrompt("dismissed"));

    await expect(store.promptInstall()).resolves.toBe("dismissed");
    expect(store.getInstallPromptState().prompt).toBeNull();
    await expect(store.promptInstall()).resolves.toBe("unavailable");
  });

  it("marks the app installed", async () => {
    const store = await loadStore();
    store.subscribeInstallPrompt(() => {});
    window.dispatchEvent(fakePrompt());
    window.dispatchEvent(new Event("appinstalled"));

    expect(store.getInstallPromptState()).toEqual({ prompt: null, installed: true });
  });

  it("the inline capture script holds the event for later", async () => {
    const { EARLY_INSTALL_PROMPT_CAPTURE } = await loadStore();
    new Function(EARLY_INSTALL_PROMPT_CAPTURE)();
    const event = fakePrompt();
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect((window as unknown as Record<string, unknown>).__vmInstallPrompt).toBe(event);
  });
});
