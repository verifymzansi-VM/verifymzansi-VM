import { describe, expect, it } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { UploadProgressPanel, useUploadProgress, type UploadSlot } from "./upload-progress-panel";

const slots: UploadSlot[] = [
  {
    key: "photos",
    label: "Uploading photos...",
    doneLabel: "Photos uploaded",
    status: "uploading",
  },
  {
    key: "video",
    label: "Preparing and verifying video...",
    doneLabel: "Video ready",
    status: "uploading",
  },
  { key: "saving", label: "Saving listing...", doneLabel: "Saved", status: "idle" },
];

describe("UploadProgressPanel", () => {
  it("shows each upload's percent, the video phase and the keep-open note", () => {
    render(
      <UploadProgressPanel
        visible
        slots={slots}
        progress={{
          "photos:cover": { percent: 20 },
          "photos:gallery": { percent: 60 },
          video: { phase: "preparing", percent: 35 },
        }}
      />
    );

    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByTestId("upload-progress-photos")).toHaveStyle({ width: "40%" });
    expect(screen.getByText("Converting 35%")).toBeInTheDocument();
    expect(screen.getByText("Keep this page open until it finishes.")).toBeInTheDocument();
  });

  it("says the video is being checked once its upload reaches 100%", () => {
    const { rerender } = render(
      <UploadProgressPanel
        visible
        slots={slots}
        progress={{ video: { phase: "uploading", percent: 99 } }}
      />
    );
    expect(screen.getByText("Uploading 99%")).toBeInTheDocument();
    rerender(
      <UploadProgressPanel
        visible
        slots={slots}
        progress={{ video: { phase: "uploading", percent: 100 } }}
      />
    );
    expect(screen.getByText("Checking video…")).toBeInTheDocument();
    expect(screen.queryByText("Uploading 100%")).not.toBeInTheDocument();
  });

  it("drops the note once only saving is left", () => {
    render(
      <UploadProgressPanel
        visible
        slots={slots.map((slot) =>
          slot.key === "saving" ? { ...slot, status: "uploading" } : { ...slot, status: "done" }
        )}
      />
    );

    expect(screen.queryByText("Keep this page open until it finishes.")).not.toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });
});

describe("useUploadProgress", () => {
  const file = (bytes: number) => new File([new Uint8Array(bytes)], "f.bin");

  it("weights a slot by the bytes of every queued file and never goes back", () => {
    const { result } = renderHook(() => useUploadProgress());
    const cover = [file(100)];
    const gallery = [file(900)];
    let trackCover!: (p: number) => void;
    let trackGallery!: (p: number) => void;
    act(() => {
      trackCover = result.current.track("photos:cover", cover);
      trackGallery = result.current.track("photos:gallery", gallery);
    });
    const percent = () => result.current.values.photos?.percent;

    act(() => trackCover(100));
    expect(percent()).toBe(10);
    act(() => trackGallery(50));
    expect(percent()).toBe(55);
    // A retry restarts the gallery request at 0: the bar holds.
    act(() => trackGallery(0));
    expect(percent()).toBe(55);
    act(() => trackGallery(40));
    expect(percent()).toBe(55);
    act(() => trackGallery(100));
    expect(percent()).toBe(100);
  });

  it("combines several videos into one slot by bytes", () => {
    const { result } = renderHook(() => useUploadProgress());
    const videos = [file(300), file(100)];
    let track!: ReturnType<typeof result.current.trackVideo>;
    act(() => {
      track = result.current.trackVideo("videos", videos);
    });
    act(() => track({ phase: "uploading", percent: 100, file: videos[1] }));
    expect(result.current.values.videos?.percent).toBe(25);
    act(() => track({ phase: "uploading", percent: 100, file: videos[0] }));
    expect(result.current.values.videos?.percent).toBe(100);
  });
});
