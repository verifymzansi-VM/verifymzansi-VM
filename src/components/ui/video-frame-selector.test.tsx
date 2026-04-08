import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  withScope: vi.fn(),
}));

import { VideoFrameSelector } from "./video-frame-selector";

/* ------------------------------------------------------------------ */
/* helpers & mocks                                                    */
/* ------------------------------------------------------------------ */

const mockToBlob = vi.fn((cb: BlobCallback, _type?: string, _quality?: number) => {
  const blob = new Blob(["fake-jpeg"], { type: "image/jpeg" });
  cb(blob);
});

const mockToDataURL = vi.fn(() => "data:image/jpeg;base64,AAAA");

beforeEach(() => {
  vi.clearAllMocks();

  vi.stubGlobal(
    "URL",
    class MockURL extends URL {
      static createObjectURL = vi.fn(() => "blob:mock-video");
      static revokeObjectURL = vi.fn();
    }
  );

  // Mock HTMLVideoElement methods
  vi.spyOn(HTMLVideoElement.prototype, "load").mockImplementation(() => {});

  // Mock canvas context
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(mockToBlob);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(mockToDataURL());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeVideoFile(name = "video.mp4") {
  return new File(["fake-video-data"], name, { type: "video/mp4" });
}

/* ------------------------------------------------------------------ */
/* tests                                                              */
/* ------------------------------------------------------------------ */

describe("VideoFrameSelector", () => {
  it("renders header text", () => {
    const onFrameSelect = vi.fn();
    render(<VideoFrameSelector file={makeVideoFile()} onFrameSelect={onFrameSelect} />);
    expect(screen.getByText("Choose video cover frame")).toBeInTheDocument();
  });

  it("creates object URL from the video file", () => {
    const onFrameSelect = vi.fn();
    render(<VideoFrameSelector file={makeVideoFile()} onFrameSelect={onFrameSelect} />);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("shows the hidden video element with correct role", () => {
    const onFrameSelect = vi.fn();
    const { container } = render(
      <VideoFrameSelector file={makeVideoFile()} onFrameSelect={onFrameSelect} />
    );
    const video = container.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video?.classList.contains("sr-only")).toBe(true);
  });

  it("shows the hidden canvas element", () => {
    const onFrameSelect = vi.fn();
    const { container } = render(
      <VideoFrameSelector file={makeVideoFile()} onFrameSelect={onFrameSelect} />
    );
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const onFrameSelect = vi.fn();
    const { container } = render(
      <VideoFrameSelector
        file={makeVideoFile()}
        onFrameSelect={onFrameSelect}
        className="my-custom-class"
      />
    );
    expect(container.firstChild).toHaveClass("my-custom-class");
  });

  it("revokes object URL on unmount", () => {
    const onFrameSelect = vi.fn();
    const { unmount } = render(
      <VideoFrameSelector file={makeVideoFile()} onFrameSelect={onFrameSelect} />
    );
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-video");
  });
});
