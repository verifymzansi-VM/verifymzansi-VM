import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImmersiveDetailGate } from "./immersive-detail-gate";
import type { FeedSlide } from "@/lib/feed/types";

const mocks = vi.hoisted(() => ({ fail: false, track: vi.fn().mockResolvedValue(true) }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function TestViewer() {
      if (mocks.fail) throw new Error("Viewer chunk unavailable");
      return <div>Desktop viewer</div>;
    },
}));
vi.mock("@/lib/views/content-views", () => ({ trackContentView: mocks.track }));
const slide = { id: "one", href: "/listing/one", targetType: "listing" } as FeedSlide;

describe("desktop viewer gate", () => {
  beforeEach(() => {
    mocks.fail = false;
    mocks.track.mockClear();
  });

  function matchDesktop(matches: boolean) {
    vi.spyOn(window, "matchMedia").mockImplementation((media) => ({
      matches,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  it("keeps the classic profile on mobile", () => {
    matchDesktop(false);
    render(
      <ImmersiveDetailGate initialSlide={slide}>
        <p>Classic profile</p>
      </ImmersiveDetailGate>
    );
    expect(screen.getByText("Classic profile")).toBeVisible();
    expect(screen.queryByText("Desktop viewer")).not.toBeInTheDocument();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("hides classic playback and mounts the desktop viewer outside the page shell", () => {
    matchDesktop(true);
    const { container } = render(
      <div data-desktop-scale>
        <ImmersiveDetailGate initialSlide={slide}>
          <p>Classic profile</p>
        </ImmersiveDetailGate>
      </div>
    );
    expect(screen.getByText("Classic profile")).not.toBeVisible();
    expect(screen.getByText("Desktop viewer")).toBeVisible();
    expect(container.contains(screen.getByText("Desktop viewer"))).toBe(false);
    expect(container.querySelector("[data-desktop-scale]")).toHaveAttribute("inert");
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("restores the classic profile if the desktop viewer fails", () => {
    matchDesktop(true);
    mocks.fail = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ImmersiveDetailGate initialSlide={slide}>
          <p>Classic profile</p>
        </ImmersiveDetailGate>
      );
      expect(screen.getByText("Classic profile")).toBeVisible();
      expect(mocks.track).toHaveBeenCalledWith({
        type: "listing",
        id: "one",
        source: "page",
        surface: "detail",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
