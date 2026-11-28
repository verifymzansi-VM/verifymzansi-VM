import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContentLikeButton,
  LIKE_FLOOR_WINDOW_MS,
  parseLikeNote,
  shownLikeCount,
} from "./content-like-button";

vi.mock("@/lib/hidden-features", () => ({ SHOW_ENGAGEMENT_TOTALS: true }));
vi.mock("@/lib/analytics/commercial-events", () => ({ trackContactAction: vi.fn() }));
vi.mock("@/lib/utils/csrf-client", () => ({
  ensureCsrfTokenReady: vi.fn().mockResolvedValue(undefined),
  withCsrfHeaders: (headers: HeadersInit) => headers,
}));
vi.mock("@/components/engagement/viewer-challenge", () => ({
  obtainViewerIdentifier: vi.fn().mockResolvedValue(false),
}));

const fetchMock = vi.fn();
const answer = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

function button() {
  return screen.getByRole("button", { name: /like this post/i });
}

function renderRail(pageCount: number) {
  return render(
    <ContentLikeButton
      targetId="post-1"
      targetType="listing"
      initialLikeCount={pageCount}
      variant="rail"
    />
  );
}

describe("ContentLikeButton: the heart and the number agree", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a waiting like in the number after a remount and a reload", async () => {
    // The like is stored as waiting: the server total (4) leaves it out.
    fetchMock.mockReturnValueOnce(answer({ liked: true, likeCount: 4 }));
    const first = renderRail(4);
    fireEvent.click(button());
    await waitFor(() => expect(button()).toHaveAccessibleName("Unlike this post. 5 likes"));
    await waitFor(() => expect(button()).toBeEnabled());
    expect(localStorage.getItem("vmz:liked:post-1")).toMatch(/^count:5:at:\d+$/);

    // Scroll away and back: the card remounts with the cached page count.
    first.unmount();
    const again = renderRail(4);
    expect(button()).toHaveAccessibleName("Unlike this post. 5 likes");

    // A reload later, once the page count includes the like and one more.
    again.unmount();
    renderRail(6);
    expect(button()).toHaveAccessibleName("Unlike this post. 6 likes");
  });

  it("unliking sends liked false, forgets the note and shows the server total", async () => {
    fetchMock.mockReturnValueOnce(answer({ liked: true, likeCount: 4 }));
    const view = renderRail(4);
    fireEvent.click(button());
    await waitFor(() => expect(button()).toHaveAccessibleName("Unlike this post. 5 likes"));
    await waitFor(() => expect(button()).toBeEnabled());
    expect(localStorage.getItem("vmz:liked:post-1")).toMatch(/^count:5:at:\d+$/);

    fetchMock.mockReturnValueOnce(answer({ liked: false, likeCount: 4 }));
    fireEvent.click(button());
    await waitFor(() => expect(button()).toHaveAccessibleName("Like this post. 4 likes"));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ liked: false });
    expect(localStorage.getItem("vmz:liked:post-1")).toBeNull();

    view.unmount();
    renderRail(4);
    expect(button()).toHaveAccessibleName("Like this post. 4 likes");
  });

  it("an older note without a count still shows at least one like", () => {
    localStorage.setItem("vmz:liked:post-1", "1");
    renderRail(0);
    expect(button()).toHaveAccessibleName("Unlike this post. 1 like");
  });

  it("reads and applies the note", async () => {
    expect(parseLikeNote(null)).toEqual({ liked: false, count: null });
    expect(parseLikeNote("1")).toEqual({ liked: true, count: null });
    const now = 1_000_000_000_000;
    expect(parseLikeNote(`count:7:at:${now}`, now + 1000)).toEqual({ liked: true, count: 7 });
    // After the window the note keeps the heart but no longer raises the number.
    expect(parseLikeNote(`count:7:at:${now}`, now + LIKE_FLOOR_WINDOW_MS)).toEqual({
      liked: true,
      count: null,
    });
    expect(shownLikeCount(3, { liked: true, count: 7 })).toBe(7);
    expect(shownLikeCount(9, { liked: true, count: 7 })).toBe(9);
    expect(shownLikeCount(3, { liked: false, count: null })).toBe(3);
    await act(async () => {});
  });

  it("stops raising the number once the window has passed", () => {
    const at = Date.now() - LIKE_FLOOR_WINDOW_MS - 1000;
    // Liked at 5; others (or this account elsewhere) unliked since: the page says 3.
    localStorage.setItem("vmz:liked:post-1", `count:5:at:${at}`);
    renderRail(3);
    expect(button()).toHaveAccessibleName("Unlike this post. 3 likes");
  });

  it("a recent like still shows within the window", () => {
    localStorage.setItem("vmz:liked:post-1", `count:5:at:${Date.now() - 60_000}`);
    renderRail(4);
    expect(button()).toHaveAccessibleName("Unlike this post. 5 likes");
  });
});
