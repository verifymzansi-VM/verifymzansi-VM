import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentLikeButton, parseLikeNote, shownLikeCount } from "./content-like-button";

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
    expect(localStorage.getItem("vmz:liked:post-1")).toBe("count:5");

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
    expect(localStorage.getItem("vmz:liked:post-1")).toBe("count:5");

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
    expect(parseLikeNote("count:7")).toEqual({ liked: true, count: 7 });
    expect(shownLikeCount(3, { liked: true, count: 7 })).toBe(7);
    expect(shownLikeCount(9, { liked: true, count: 7 })).toBe(9);
    expect(shownLikeCount(3, { liked: false, count: null })).toBe(3);
    await act(async () => {});
  });
});
