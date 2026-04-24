import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MediaUpload } from "./media-upload";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

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

describe("MediaUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => "blob:preview-url");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("normalizes extensionless mobile filenames before storing them in form state", async () => {
    render(<Harness />);

    const input = screen.getByLabelText("Upload photos and videos");
    const file = new File(["jpeg-binary"], "1000061870", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByAltText("1000061870.jpg")).toBeInTheDocument();
    });
  });

  it("shows an inline preview message when the browser cannot render a selected file", async () => {
    render(<Harness />);

    const input = screen.getByLabelText("Upload photos and videos");
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
    expect(screen.getByText("0 selected. 10 of 10 remaining.")).toBeInTheDocument();
  });

  it("shows rejected files inline", async () => {
    render(<Harness />);

    const input = screen.getByLabelText("Upload photos and videos");
    const file = new File(["plain"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Some files were not added")).toBeInTheDocument();
    });
    expect(screen.getByText(/notes\.txt/)).toBeInTheDocument();
  });
});
