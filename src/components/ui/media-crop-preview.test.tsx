import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  withScope: vi.fn(),
}));

import { MediaCropPreview } from "./media-crop-preview";

/* ------------------------------------------------------------------ */
/* helpers & mocks                                                    */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();

  vi.stubGlobal(
    "URL",
    class MockURL extends URL {
      static createObjectURL = vi.fn(() => "blob:mock-image");
      static revokeObjectURL = vi.fn();
    }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeImageFile(name = "photo.jpg") {
  return new File(["fake-image-data"], name, { type: "image/jpeg" });
}

/* ------------------------------------------------------------------ */
/* tests                                                              */
/* ------------------------------------------------------------------ */

describe("MediaCropPreview", () => {
  it("renders header with Move icon text", () => {
    const onChange = vi.fn();
    render(<MediaCropPreview file={makeImageFile()} onChange={onChange} />);
    expect(screen.getByText("Adjust how your image appears on cards")).toBeInTheDocument();
  });

  it("creates object URL from the image file", () => {
    const onChange = vi.fn();
    render(<MediaCropPreview file={makeImageFile()} onChange={onChange} />);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("renders crop preview with aria slider role", () => {
    const onChange = vi.fn();
    render(<MediaCropPreview file={makeImageFile()} onChange={onChange} />);
    const slider = screen.getByRole("slider");
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute("aria-label", "Drag to position crop");
  });

  it("shows default 4:5 card overlay label", () => {
    const onChange = vi.fn();
    render(<MediaCropPreview file={makeImageFile()} onChange={onChange} />);
    expect(screen.getByText("4:5 card")).toBeInTheDocument();
  });

  it("shows 16:9 hero overlay label when aspectRatio is 16/9", () => {
    const onChange = vi.fn();
    render(<MediaCropPreview file={makeImageFile()} aspectRatio={16 / 9} onChange={onChange} />);
    expect(screen.getByText("16:9 hero")).toBeInTheDocument();
  });

  it("shows aria-valuetext reflecting focal point coordinates", () => {
    const onChange = vi.fn();
    render(
      <MediaCropPreview file={makeImageFile()} value={{ x: 0.3, y: 0.7 }} onChange={onChange} />
    );
    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-valuetext",
      "Focal point at 30% horizontal, 70% vertical"
    );
  });

  it("calls onChange on ArrowRight key", () => {
    const onChange = vi.fn();
    render(
      <MediaCropPreview file={makeImageFile()} value={{ x: 0.5, y: 0.5 }} onChange={onChange} />
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ x: 0.52, y: 0.5 });
  });

  it("calls onChange on ArrowLeft key", () => {
    const onChange = vi.fn();
    render(
      <MediaCropPreview file={makeImageFile()} value={{ x: 0.5, y: 0.5 }} onChange={onChange} />
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith({ x: 0.48, y: 0.5 });
  });

  it("calls onChange on ArrowUp key", () => {
    const onChange = vi.fn();
    render(
      <MediaCropPreview file={makeImageFile()} value={{ x: 0.5, y: 0.5 }} onChange={onChange} />
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith({ x: 0.5, y: 0.48 });
  });

  it("calls onChange on ArrowDown key", () => {
    const onChange = vi.fn();
    render(
      <MediaCropPreview file={makeImageFile()} value={{ x: 0.5, y: 0.5 }} onChange={onChange} />
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith({ x: 0.5, y: 0.52 });
  });

  it("clamps ArrowLeft at 0 boundary", () => {
    const onChange = vi.fn();
    render(
      <MediaCropPreview file={makeImageFile()} value={{ x: 0.01, y: 0.5 }} onChange={onChange} />
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith({ x: 0, y: 0.5 });
  });

  it("clamps ArrowRight at 1 boundary", () => {
    const onChange = vi.fn();
    render(
      <MediaCropPreview file={makeImageFile()} value={{ x: 0.99, y: 0.5 }} onChange={onChange} />
    );
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ x: 1, y: 0.5 });
  });

  it("applies custom className", () => {
    const onChange = vi.fn();
    const { container } = render(
      <MediaCropPreview file={makeImageFile()} onChange={onChange} className="my-custom" />
    );
    expect(container.firstChild).toHaveClass("my-custom");
  });

  it("shows instruction text", () => {
    const onChange = vi.fn();
    render(<MediaCropPreview file={makeImageFile()} onChange={onChange} />);
    expect(screen.getByText(/Drag the image to position/)).toBeInTheDocument();
  });

  it("revokes object URL on unmount", () => {
    const onChange = vi.fn();
    const { unmount } = render(<MediaCropPreview file={makeImageFile()} onChange={onChange} />);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-image");
  });
});
