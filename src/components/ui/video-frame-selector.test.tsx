import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("takes frames from the picked video at once, without waiting for its preparation", () => {
    const picked = makeVideoFile("phone.mp4");
    const prepareVideo = vi.fn(() => new Promise<File>(() => {}));
    const { container } = render(
      <VideoFrameSelector file={picked} onFrameSelect={vi.fn()} prepareVideo={prepareVideo} />
    );
    expect(screen.getByText("Choose video cover frame")).toBeInTheDocument();
    expect(container.querySelector("video")).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenLastCalledWith(picked);
    expect(prepareVideo).not.toHaveBeenCalled();
  });

  it.each(["error", "no picture"])(
    "when this browser cannot show the picked video (%s), takes frames from the prepared one",
    async (failure) => {
      const picked = makeVideoFile("phone.mov");
      const prepared = makeVideoFile("phone.mp4");
      let finish: (file: File) => void = () => {};
      const prepareVideo = vi.fn((_file: File, onProgress: (percent: number) => void) => {
        onProgress(35);
        return new Promise<File>((resolve) => {
          finish = resolve;
        });
      });
      const { container } = render(
        <VideoFrameSelector file={picked} onFrameSelect={vi.fn()} prepareVideo={prepareVideo} />
      );
      const video = container.querySelector("video")!;
      if (failure === "error") fireEvent.error(video);
      else fireEvent.loadedMetadata(video); // jsdom: videoWidth is 0
      expect(
        await screen.findByText("Preparing the video for its cover frame (35%)…")
      ).toBeInTheDocument();
      expect(prepareVideo).toHaveBeenCalledWith(picked, expect.any(Function));

      finish(prepared);
      expect(await screen.findByText("Choose video cover frame")).toBeInTheDocument();
      expect(URL.createObjectURL).toHaveBeenLastCalledWith(prepared);
    }
  );

  it("stops waiting when the preparation fails", async () => {
    const picked = makeVideoFile();
    const { container } = render(
      <VideoFrameSelector
        file={picked}
        onFrameSelect={vi.fn()}
        prepareVideo={() => Promise.reject(new Error("bad video"))}
      />
    );
    fireEvent.error(container.querySelector("video")!);
    expect(await screen.findByText("Choose video cover frame")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    [true, 1],
    [false, 0],
  ])("picks a frame by itself (at 1 s) only when asked: %s", (autoSelect, seekedTo) => {
    const { container } = render(
      <VideoFrameSelector file={makeVideoFile()} onFrameSelect={vi.fn()} autoSelect={autoSelect} />
    );
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "duration", { value: 20 });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(seekedTo);
  });
});
