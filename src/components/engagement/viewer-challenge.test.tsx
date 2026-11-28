/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const widget = vi.hoisted(() => ({ fail: false }));
vi.mock("next/navigation", () => ({ usePathname: () => "/mzansi-business/post-1" }));
// Cloudflare wants a click: the widget renders and waits (or fails at once).
vi.mock("@/components/ui/turnstile-widget", () => ({
  TurnstileWidget: ({ onError }: { onError: () => void }) => {
    if (widget.fail) queueMicrotask(onError);
    return <button type="button">Verify you are human</button>;
  },
}));

import { PrelaunchBanner } from "@/components/layout/prelaunch-banner";
import {
  CHALLENGE_Z_INDEX,
  obtainViewerIdentifier,
  resetViewerChallengeForTests,
} from "./viewer-challenge";

/** The overlays a visitor can have open while a view is sent. */
const OVERLAY_Z = {
  welcomeDialog: 90, // prelaunch-banner.tsx, fixed inset-0 z-[90]
  desktopViewer: 50, // immersive-viewer.tsx, fixed inset-0 z-50
  videoMode: 50, // video-mode-viewer.tsx, fixed inset-0 z-50
  highestInTheApp: 201,
};

function checkHost() {
  return document.querySelector<HTMLElement>("[data-viewer-challenge]");
}

beforeEach(() => {
  widget.fail = false;
  window.sessionStorage.clear();
  resetViewerChallengeForTests();
});

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-viewer-challenge]").forEach((host) => host.remove());
});

describe("viewer check placement", () => {
  it("sits above the welcome dialog and both viewers, and stays clickable", async () => {
    render(<PrelaunchBanner />);
    await screen.findByRole("dialog");
    void obtainViewerIdentifier();

    const host = await vi.waitFor(() => {
      const found = checkHost();
      if (!found) throw new Error("no check yet");
      return found;
    });
    expect(Number(host.style.zIndex)).toBe(CHALLENGE_Z_INDEX);
    for (const z of Object.values(OVERLAY_Z)) expect(Number(host.style.zIndex)).toBeGreaterThan(z);
    expect(host.style.pointerEvents).toBe("auto");
    expect(host.parentElement).toBe(document.body);
    // Screen readers find it; keyboard users reach it (it is not hidden).
    expect(screen.getByRole("region", { name: "Security check" })).toBe(host);
    expect(host.closest("[aria-hidden='true']")).toBeNull();
    expect(await screen.findByRole("button", { name: "Verify you are human" })).toBeVisible();
  });

  it("the welcome pop-up steps aside while the check is on screen", async () => {
    render(<PrelaunchBanner />);
    await screen.findByRole("dialog");
    void obtainViewerIdentifier();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(checkHost()).not.toBeNull();
  });
});

describe("viewer check back-off", () => {
  it("a failed check is not started again on the next page open for 10 minutes", async () => {
    widget.fail = true;
    const first = obtainViewerIdentifier();
    await screen.findByRole("button", { name: "Verify you are human" });
    await expect(first).resolves.toBe(false);
    expect(Number(window.sessionStorage.getItem("vmz:viewer-check-failed-at"))).toBeGreaterThan(0);
    document.querySelectorAll("[data-viewer-challenge]").forEach((host) => host.remove());

    // A reload: the page's memory is new, the tab's storage is kept, so no new
    // check starts and no widget shows.
    resetViewerChallengeForTests({ keepStorage: true });
    await expect(obtainViewerIdentifier()).resolves.toBe(false);
    expect(checkHost()).toBeNull();
  });
});
