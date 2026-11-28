/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/mzansi-business/post-1" }));
// Cloudflare wants a click: the widget renders and waits.
vi.mock("@/components/ui/turnstile-widget", () => ({
  TurnstileWidget: () => <button type="button">Verify you are human</button>,
}));

import { PrelaunchBanner } from "@/components/layout/prelaunch-banner";
import { CHALLENGE_Z_INDEX, obtainViewerIdentifier } from "./viewer-challenge";

/** The overlays a visitor can have open while a view is sent. */
const OVERLAY_Z = {
  welcomeDialog: 90, // prelaunch-banner.tsx, fixed inset-0 z-[90]
  desktopViewer: 50, // immersive-viewer.tsx, fixed inset-0 z-50
  videoMode: 50, // video-mode-viewer.tsx, fixed inset-0 z-50
  highestInTheApp: 201,
};

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
      const found = document.querySelector<HTMLElement>("[data-viewer-challenge]");
      if (!found) throw new Error("no check yet");
      return found;
    });
    expect(Number(host.style.zIndex)).toBe(CHALLENGE_Z_INDEX);
    for (const z of Object.values(OVERLAY_Z)) expect(Number(host.style.zIndex)).toBeGreaterThan(z);
    // A modal dialog switches pointer events off on the body; the check keeps them.
    expect(host.style.pointerEvents).toBe("auto");
    expect(host.parentElement).toBe(document.body);
    expect(await screen.findByText("Verify you are human")).toBeInTheDocument();
  });
});
