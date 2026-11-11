import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const items = [
  { url: "/a.jpg", kind: "photo" as const },
  { url: "/b.jpg", kind: "photo" as const },
];

afterEach(() => {
  vi.doUnmock("@/components/ui/media-lightbox");
  vi.resetModules();
  vi.useRealTimers();
});

async function loadWrapper() {
  vi.resetModules();
  vi.doMock("@/components/ui/media-lightbox", () => ({
    MediaLightbox: ({ isOpen, startIndex }: { isOpen: boolean; startIndex?: number }) => (
      <div data-testid="viewer" data-open={String(isOpen)}>
        photo {startIndex}
      </div>
    ),
  }));
  return import("./media-lightbox-lazy");
}

describe("lazy MediaLightbox", () => {
  it("renders nothing and loads nothing before the page is idle or the viewer opens", async () => {
    vi.useFakeTimers();
    const { MediaLightbox } = await loadWrapper();
    const { container } = render(
      <MediaLightbox items={items} startIndex={0} isOpen={false} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens at the chosen photo and stays mounted after closing", async () => {
    const { MediaLightbox } = await loadWrapper();
    const onClose = vi.fn();
    const { rerender } = render(
      <MediaLightbox items={items} startIndex={0} isOpen={false} onClose={onClose} />
    );
    expect(screen.queryByTestId("viewer")).toBeNull();

    rerender(<MediaLightbox items={items} startIndex={1} isOpen onClose={onClose} />);
    const viewer = await screen.findByTestId("viewer");
    expect(viewer).toHaveAttribute("data-open", "true");
    expect(viewer).toHaveTextContent("photo 1");

    // Closing keeps the viewer mounted so its own closing animation can run.
    rerender(<MediaLightbox items={items} startIndex={1} isOpen={false} onClose={onClose} />);
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-open", "false");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens in the same render once the code has been fetched in advance", async () => {
    const { MediaLightbox, loadMediaLightbox } = await loadWrapper();
    await loadMediaLightbox();
    const { rerender } = render(
      <MediaLightbox items={items} startIndex={0} isOpen={false} onClose={() => {}} />
    );
    rerender(<MediaLightbox items={items} startIndex={0} isOpen onClose={() => {}} />);
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-open", "true");
  });

  it("gives the page its closed state back when the code cannot be fetched", async () => {
    vi.resetModules();
    vi.doMock("@/components/ui/media-lightbox", () => {
      throw new Error("offline");
    });
    const { MediaLightbox } = await import("./media-lightbox-lazy");
    const onClose = vi.fn();
    render(<MediaLightbox items={items} startIndex={0} isOpen onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("viewer")).toBeNull();
  });
});
