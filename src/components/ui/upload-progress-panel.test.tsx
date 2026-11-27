import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UploadProgressPanel, type UploadSlot } from "./upload-progress-panel";

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
