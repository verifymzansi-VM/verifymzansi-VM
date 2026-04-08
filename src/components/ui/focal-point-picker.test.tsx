/* eslint-disable @next/next/no-img-element */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  withScope: vi.fn(),
}));

// Mock next/image to a plain <img>
vi.mock("next/image", () => ({
   
  default: ({ alt, ...props }: { alt?: string } & Record<string, unknown>) => (
    <img alt={typeof alt === "string" ? alt : ""} {...props} />
  ),
}));

import { FocalPointPicker } from "./focal-point-picker";

/* ------------------------------------------------------------------ */
/* setup & teardown                                                   */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* tests                                                              */
/* ------------------------------------------------------------------ */

describe("FocalPointPicker", () => {
  const defaultProps = {
    src: "https://example.com/photo.jpg",
    onChange: vi.fn(),
  };

  it("renders the instruction text", () => {
    render(<FocalPointPicker {...defaultProps} />);
    expect(screen.getByText(/tap on the image to set the focal point/i)).toBeInTheDocument();
  });

  it("renders the image with correct src", () => {
    render(<FocalPointPicker {...defaultProps} alt="Test photo" />);
    const img = screen.getByAltText("Test photo");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/photo.jpg");
  });

  it("renders crosshair marker", () => {
    render(<FocalPointPicker {...defaultProps} />);
    // The button container should be present
    const button = screen.getByRole("button", { name: /click to set focal point/i });
    expect(button).toBeInTheDocument();
  });

  it("calls onChange on click with normalised coordinates", () => {
    const onChange = vi.fn();
    render(<FocalPointPicker {...defaultProps} onChange={onChange} />);
    const button = screen.getByRole("button", { name: /click to set focal point/i });

    // Mock getBoundingClientRect
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 250,
      right: 200,
      bottom: 250,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.click(button, { clientX: 100, clientY: 125 });
    expect(onChange).toHaveBeenCalledWith({ x: 0.5, y: 0.5 });
  });

  it("clamps coordinates to 0..1 range", () => {
    const onChange = vi.fn();
    render(<FocalPointPicker {...defaultProps} onChange={onChange} />);
    const button = screen.getByRole("button", { name: /click to set focal point/i });

    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 100,
      width: 200,
      height: 250,
      right: 300,
      bottom: 350,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });

    // Click outside left of the container
    fireEvent.click(button, { clientX: 50, clientY: 100 });
    expect(onChange).toHaveBeenCalledWith({ x: 0, y: 0 });
  });

  it("supports keyboard ArrowRight", () => {
    const onChange = vi.fn();
    render(<FocalPointPicker {...defaultProps} value={{ x: 0.5, y: 0.5 }} onChange={onChange} />);
    const button = screen.getByRole("button", { name: /click to set focal point/i });
    fireEvent.keyDown(button, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ x: 0.51, y: 0.5 });
  });

  it("supports keyboard ArrowLeft", () => {
    const onChange = vi.fn();
    render(<FocalPointPicker {...defaultProps} value={{ x: 0.5, y: 0.5 }} onChange={onChange} />);
    const button = screen.getByRole("button", { name: /click to set focal point/i });
    fireEvent.keyDown(button, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith({ x: 0.49, y: 0.5 });
  });

  it("supports keyboard ArrowUp", () => {
    const onChange = vi.fn();
    render(<FocalPointPicker {...defaultProps} value={{ x: 0.5, y: 0.5 }} onChange={onChange} />);
    const button = screen.getByRole("button", { name: /click to set focal point/i });
    fireEvent.keyDown(button, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith({ x: 0.5, y: 0.49 });
  });

  it("supports keyboard ArrowDown", () => {
    const onChange = vi.fn();
    render(<FocalPointPicker {...defaultProps} value={{ x: 0.5, y: 0.5 }} onChange={onChange} />);
    const button = screen.getByRole("button", { name: /click to set focal point/i });
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith({ x: 0.5, y: 0.51 });
  });

  it("clamps keyboard ArrowLeft at 0", () => {
    const onChange = vi.fn();
    render(<FocalPointPicker {...defaultProps} value={{ x: 0, y: 0.5 }} onChange={onChange} />);
    const button = screen.getByRole("button", { name: /click to set focal point/i });
    fireEvent.keyDown(button, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith({ x: 0, y: 0.5 });
  });

  it("clamps keyboard ArrowRight at 1", () => {
    const onChange = vi.fn();
    render(<FocalPointPicker {...defaultProps} value={{ x: 1, y: 0.5 }} onChange={onChange} />);
    const button = screen.getByRole("button", { name: /click to set focal point/i });
    fireEvent.keyDown(button, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ x: 1, y: 0.5 });
  });

  it("applies custom className", () => {
    const { container } = render(
      <FocalPointPicker {...defaultProps} className="my-custom-class" />
    );
    expect(container.firstChild).toHaveClass("my-custom-class");
  });

  it("defaults to centre (0.5, 0.5) when no value provided", () => {
    render(<FocalPointPicker {...defaultProps} />);
    const button = screen.getByRole("button", { name: /click to set focal point/i });
    expect(button).toHaveClass("focal-pos-x-50", "focal-pos-y-50");
  });
});
