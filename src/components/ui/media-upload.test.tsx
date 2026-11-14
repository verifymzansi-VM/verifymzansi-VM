import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MediaUpload } from "./media-upload";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

/** jsdom cannot read real video headers; each test states the picked clip's length. */
const pickedLength = vi.hoisted(() => ({ seconds: 30 as number | null }));
vi.mock("@/lib/media/video-length-client", async () => {
  const { videoLengthProblem } = await import("@/lib/media/video-length");
  return {
    checkPickedVideoLength: vi.fn(async (_file: Blob, limit: number) =>
      videoLengthProblem(pickedLength.seconds, limit)
    ),
  };
});

function EventVideoHarness({ maxVideoSeconds }: { maxVideoSeconds?: number }) {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <MediaUpload
      id="event-video-upload"
      label="Event video"
      files={files}
      onChange={setFiles}
      accept="video/*"
      maxFiles={1}
      maxVideoSeconds={maxVideoSeconds}
    />
  );
}

function Harness() {
  const [files, setFiles] = useState<File[]>([]);

  return (
    <MediaUpload
      id="photos-upload"
      label="Photos"
      description="Add clear photos of the item."
      error="Upload at least one photo."
      files={files}
      onChange={setFiles}
      accept="image/*"
    />
  );
}

function SingleVideoHarness() {
  const [files, setFiles] = useState<File[]>([]);

  return (
    <MediaUpload
      id="video-upload"
      label="Video"
      files={files}
      onChange={setFiles}
      accept="video/*"
      maxFiles={1}
    />
  );
}

describe("MediaUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pickedLength.seconds = 30;
    global.URL.createObjectURL = vi.fn(() => "blob:preview-url");
    global.URL.revokeObjectURL = vi.fn();
  });

  describe("video length (M4.4)", () => {
    const pick = (name = "clip.mp4") => {
      fireEvent.change(screen.getByLabelText("Event video"), {
        target: { files: [new File(["video"], name, { type: "video/mp4" })] },
      });
    };

    it("accepts 119 s and refuses 121 s with the real length in the message", async () => {
      pickedLength.seconds = 121;
      render(<EventVideoHarness />);
      pick("long.mp4");
      expect(
        await screen.findByText('"long.mp4": Your video is 2 min 1 s; the limit is 2 minutes.')
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove long.mp4" })).not.toBeInTheDocument();

      pickedLength.seconds = 119;
      pick("ok.mp4");
      expect(await screen.findByRole("button", { name: "Remove ok.mp4" })).toBeInTheDocument();
    });

    it("uses the event limit: 59 s accepted, 61 s refused", async () => {
      pickedLength.seconds = 61;
      render(<EventVideoHarness maxVideoSeconds={60} />);
      pick("event.mp4");
      expect(
        await screen.findByText('"event.mp4": Your video is 1 min 1 s; the limit is 1 minute.')
      ).toBeInTheDocument();

      pickedLength.seconds = 59;
      pick("short.mp4");
      expect(await screen.findByRole("button", { name: "Remove short.mp4" })).toBeInTheDocument();
    });

    it("refuses a video whose length cannot be read", async () => {
      pickedLength.seconds = null;
      render(<EventVideoHarness />);
      pick("unknown.mp4");
      expect(
        await screen.findByText(
          "\"unknown.mp4\": We couldn't read this video's length; please export it as MP4."
        )
      ).toBeInTheDocument();
    });

    it("accepts a phone original over 50 MB so it can be converted before upload", async () => {
      render(<EventVideoHarness />);
      const original = new File(["video"], "phone.mp4", { type: "video/mp4" });
      Object.defineProperty(original, "size", { value: 120 * 1024 * 1024 });
      fireEvent.change(screen.getByLabelText("Event video"), { target: { files: [original] } });
      expect(await screen.findByRole("button", { name: "Remove phone.mp4" })).toBeInTheDocument();
    });
  });

  it("normalizes extensionless mobile filenames before storing them in form state", async () => {
    render(<Harness />);

    const input = screen.getByLabelText("Photos");
    const file = new File(["jpeg-binary"], "1000061870", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByAltText("1000061870.jpg")).toBeInTheDocument();
    });
  });

  it("shows an inline preview message when the browser cannot render a selected file", async () => {
    render(<Harness />);

    const input = screen.getByLabelText("Photos");
    const file = new File(["jpeg-binary"], "1000061870", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByAltText("1000061870.jpg")).toBeInTheDocument();
    });

    fireEvent.error(screen.getByAltText("1000061870.jpg"));

    expect(screen.getByText(/Preview unavailable for "1000061870\.jpg"/i)).toBeInTheDocument();
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  });

  it("associates labels, guidance, counts, and errors with the file input", () => {
    render(<Harness />);

    const input = screen.getByLabelText("Photos");

    expect(input).toHaveAttribute("id", "photos-upload");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain("photos-upload-description");
    expect(input.getAttribute("aria-describedby")).toContain("photos-upload-count");
    expect(input.getAttribute("aria-describedby")).toContain("photos-upload-error");
    expect(screen.getByText("Add clear photos of the item.")).toBeInTheDocument();
    expect(screen.getByText("Upload at least one photo.")).toBeInTheDocument();
    expect(screen.getByText("0 of 10 added. 10 remaining.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add photos/ })).toBeInTheDocument();
  });

  it("shows rejected files inline", async () => {
    render(<Harness />);

    const input = screen.getByLabelText("Photos");
    const file = new File(["plain"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Some files were not added")).toBeInTheDocument();
    });
    expect(screen.getByText(/notes\.txt/)).toBeInTheDocument();
  });

  it("keeps visible remove and replace controls when a maxFiles=1 video is selected", async () => {
    render(<SingleVideoHarness />);

    const input = screen.getByLabelText("Video");
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove clip.mp4" })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Change clip.mp4" })).toBeInTheDocument();
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
  });

  it("shows the running count, an add tile, and an always-visible remove button per photo", async () => {
    render(<Harness />);

    const input = screen.getByLabelText("Photos");
    fireEvent.change(input, {
      target: {
        files: [
          new File(["a"], "a.jpg", { type: "image/jpeg" }),
          new File(["b"], "b.jpg", { type: "image/jpeg" }),
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("2 / 10")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Remove a.jpg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add more/ })).toBeInTheDocument();
    expect(screen.getByText("Cover")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove a.jpg" }));
    await waitFor(() => {
      expect(screen.getByText("1 / 10")).toBeInTheDocument();
    });
  });

  it("shows saved media with the new picks and counts both toward the limit", () => {
    const onRemoveExisting = vi.fn();
    render(
      <MediaUpload
        id="edit-photos"
        label="Photos"
        files={[]}
        onChange={vi.fn()}
        accept="image/*"
        maxFiles={2}
        existing={[{ url: "https://cdn.example/1.jpg" }, { url: "https://cdn.example/2.jpg" }]}
        onRemoveExisting={onRemoveExisting}
      />
    );

    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add more/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Limit reached/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Photo 2" }));
    expect(onRemoveExisting).toHaveBeenCalledWith(1);
  });

  it("accepts MOV files in video mode so submit can transcode them", async () => {
    render(<SingleVideoHarness />);

    const input = screen.getByLabelText("Video");
    const file = new File(["video"], "clip.mov", { type: "video/quicktime" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove clip.mov" })).toBeInTheDocument();
    });

    expect(screen.queryByText("Some files were not added")).not.toBeInTheDocument();
  });

  it("can remove and re-select the same maxFiles=1 video", async () => {
    render(<SingleVideoHarness />);

    const input = screen.getByLabelText("Video");
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove clip.mp4" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove clip.mp4" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove clip.mp4" })).not.toBeInTheDocument();
    });

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove clip.mp4" })).toBeInTheDocument();
    });
  });
});
