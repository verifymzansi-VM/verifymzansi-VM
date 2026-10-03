import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImmersiveActionRail } from "./immersive-action-rail";
import { ImmersiveTopBar } from "./immersive-top-bar";
import {
  ViewerAppearanceProvider,
  VIEWER_THEME_KEY,
  useViewerAppearance,
} from "@/components/providers/viewer-appearance";
import { defaultBrowse } from "@/lib/feed/browse";
import type { FeedSlide } from "@/lib/feed/types";

vi.mock("@/components/listings/content-like-button", () => ({ ContentLikeButton: () => null }));
vi.mock("@/components/brand", () => ({ BrandMark: () => <span>VerifyMzansi</span> }));
const slide = {
  key: "listings:one",
  id: "one",
  targetType: "listing",
  href: "/listing/one",
  shareTitle: "An item",
  engagement: { views: 1, likes: 0 },
  mapUrl: null,
  contact: { showMessageButton: false },
} as FeedSlide;

describe("desktop profile interactions", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("does not copy a cancelled native share", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    render(<ImmersiveActionRail slide={slide} views={1} active />);
    fireEvent.click(screen.getByRole("button", { name: "Share this post" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("copies the canonical link when native sharing is unavailable", async () => {
    render(<ImmersiveActionRail slide={slide} views={1} active />);
    fireEvent.click(screen.getByRole("button", { name: "Share this post" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/listing/one`
      )
    );
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
  });

  it("announces clipboard failure", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("Blocked"));
    render(<ImmersiveActionRail slide={slide} views={1} active />);
    fireEvent.click(screen.getByRole("button", { name: "Share this post" }));
    expect(await screen.findByText(/Could not share the page/)).toBeInTheDocument();
  });

  it("discards an unsubmitted filter draft when reopened", () => {
    render(
      <ImmersiveTopBar
        browse={defaultBrowse("market", null)}
        activeVertical="market"
        sourceLabel=""
        busy={null}
        error={false}
        notice={null}
        onBrowse={vi.fn()}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Unsubmitted" } });
    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  function AppearanceProbe() {
    const appearance = useViewerAppearance();
    return <button onClick={appearance?.toggle}>{appearance?.theme}</button>;
  }

  it("defaults to dark and remembers a separate viewer preference", () => {
    localStorage.setItem("theme", "light");
    render(
      <ViewerAppearanceProvider>
        <AppearanceProbe />
      </ViewerAppearanceProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(screen.getByRole("button", { name: "light" })).toBeInTheDocument();
    expect(localStorage.getItem(VIEWER_THEME_KEY)).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("reads a remembered appearance", () => {
    localStorage.setItem(VIEWER_THEME_KEY, "light");
    render(
      <ViewerAppearanceProvider>
        <AppearanceProbe />
      </ViewerAppearanceProvider>
    );
    expect(screen.getByRole("button", { name: "light" })).toBeInTheDocument();
  });

  it("still toggles when saving the preference is blocked", () => {
    localStorage.setItem(VIEWER_THEME_KEY, "light");
    const blockedWrite = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    try {
      render(
        <ViewerAppearanceProvider>
          <AppearanceProbe />
        </ViewerAppearanceProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "light" }));
      expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    } finally {
      blockedWrite.mockRestore();
    }
  });
});
