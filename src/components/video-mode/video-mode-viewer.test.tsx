/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFixtureSlides } from "@/app/dev/immersive/fixtures";
import { defaultBrowse } from "@/lib/feed/browse";
import { VideoModeViewer } from "./video-mode-viewer";
import { AUTO_HIDE_MS } from "./use-auto-hide";

vi.mock("@/components/listings/content-like-button", () => ({
  ContentLikeButton: () => <button type="button">Like</button>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

type Playable = HTMLMediaElement & { __playing?: boolean };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (
    this: Playable
  ) {
    return !this.__playing;
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: Playable) {
    if (!this.__playing) {
      this.__playing = true;
      // Browsers fire "play" after the call returns.
      queueMicrotask(() => this.dispatchEvent(new Event("play")));
    }
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: Playable) {
    if (this.__playing) {
      this.__playing = false;
      queueMicrotask(() => this.dispatchEvent(new Event("pause")));
    }
  });
  window.localStorage.setItem("vm:video:swipe-hint", "1");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const isHidden = (element: Element | null) => Boolean(element?.closest("[inert]"));

async function renderPlaying() {
  // Start on a fixture post that opens on its video.
  const slides = buildFixtureSlides();
  const first = slides.find((slide) => slide.media[0]?.kind === "video");
  if (!first) throw new Error("fixtures need a post that opens on a video");
  render(
    <VideoModeViewer
      initialBrowse={defaultBrowse(first.vertical)}
      fixtures={[first, ...slides.filter((slide) => slide !== first)]}
    />
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  const video = document.querySelector<Playable>("video[data-vm-active-video]");
  expect(video?.__playing).toBe(true);
  return video!;
}

describe("Video mode auto-hide", () => {
  it("after 4 s hides the left column, Details and the top bar; keeps the rest", async () => {
    await renderPlaying();
    const root = document.querySelector("[data-chrome]")!;
    expect(root.getAttribute("data-chrome")).toBe("shown");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_HIDE_MS);
    });
    expect(root.getAttribute("data-chrome")).toBe("hidden");

    // Hidden: sections and filter, Details, More and Close.
    expect(isHidden(screen.getByRole("navigation", { name: "Sections" }))).toBe(true);
    expect(isHidden(screen.getByRole("button", { name: "Province and filters" }))).toBe(true);
    expect(isHidden(screen.getByRole("link", { name: /^Details/ }))).toBe(true);
    expect(isHidden(screen.getByRole("button", { name: "More options" }))).toBe(true);
    expect(isHidden(screen.getByRole("button", { name: "Close Video mode" }))).toBe(true);

    // Stay: the right column, the title and price, the progress line, sound while muted.
    expect(isHidden(screen.getByRole("group", { name: "Post actions" }))).toBe(false);
    expect(isHidden(screen.getByRole("button", { name: /Share this post/ }))).toBe(false);
    expect(isHidden(screen.getByRole("heading", { level: 1 }))).toBe(false);
    expect(isHidden(screen.getByRole("slider", { name: "Seek playback" }))).toBe(false);
    expect(isHidden(screen.getByRole("button", { name: "Turn sound on" }))).toBe(false);
  });

  it("a tap while hidden shows the controls and keeps playing; the next tap pauses", async () => {
    const video = await renderPlaying();
    const root = document.querySelector("[data-chrome]")!;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_HIDE_MS);
    });
    expect(root.getAttribute("data-chrome")).toBe("hidden");

    // A finger tap (click count 1).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause video" }), { detail: 1 });
    });
    expect(root.getAttribute("data-chrome")).toBe("shown");
    expect(video.__playing).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause video" }), { detail: 1 });
    });
    expect(video.__playing).toBe(false);
    expect(root.getAttribute("data-chrome")).toBe("shown");
  });

  it("a keyboard or screen reader press of Pause pauses at once, even while hidden", async () => {
    const video = await renderPlaying();
    const root = document.querySelector("[data-chrome]")!;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_HIDE_MS);
    });
    expect(root.getAttribute("data-chrome")).toBe("hidden");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause video" }), { detail: 0 });
    });
    expect(video.__playing).toBe(false);
    expect(root.getAttribute("data-chrome")).toBe("shown");
  });

  it.each([
    { width: 360, height: 780 },
    { width: 320, height: 568 },
  ])(
    "at $width px the title sits above a Details row that wrapped onto two lines",
    async ({ width, height }) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
      const twoRowsTop = height - 28 - (44 + 8 + 44);
      const original = Element.prototype.getBoundingClientRect;
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
        this: Element
      ) {
        return this.hasAttribute("data-vm-details")
          ? ({ top: twoRowsTop, bottom: height - 28, left: 12, right: width - 72 } as DOMRect)
          : original.call(this);
      });
      await renderPlaying();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      const caption = document.querySelector<HTMLElement>("[data-vm-caption='over']")!;
      expect(caption.style.bottom).toBe(`${height - twoRowsTop + 12}px`);
    }
  );

  it("lists the areas in roll-over order with the filter under them", async () => {
    await renderPlaying();
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const names = Array.from(nav.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label")
    );
    expect(names[0]).toMatch(/^Tourism and events/);
    expect(names.slice(1)).toEqual(["Business", "Market", "Province and filters"]);
  });
});
