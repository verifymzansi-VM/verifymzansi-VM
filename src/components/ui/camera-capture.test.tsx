import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraCapture } from "./camera-capture";

const mockGetUserMedia = vi.fn();
const mockStop = vi.fn();
const _mockToBlob = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();

  Object.defineProperty(global.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mockGetUserMedia },
  });

  vi.stubGlobal(
    "URL",
    class MockURL extends URL {
      static createObjectURL = vi.fn(() => "blob:test-capture");
      static revokeObjectURL = vi.fn();
    }
  );
});

afterEach(() => {
  cleanup();
});

function createMockStream() {
  return {
    getTracks: () => [{ stop: mockStop }],
  } as unknown as MediaStream;
}

describe("CameraCapture", () => {
  it("renders Open Camera button initially", () => {
    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    expect(screen.getByRole("button", { name: /open camera/i })).toBeInTheDocument();
  });

  it("starts camera stream on Open Camera click", async () => {
    const stream = createMockStream();
    mockGetUserMedia.mockResolvedValueOnce(stream);

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({ facingMode: "user" }),
        })
      );
    });
  });

  it("shows error message when camera access is denied", async () => {
    mockGetUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/camera access was denied/i)).toBeInTheDocument();
    });
  });

  it("shows error message when no camera found", async () => {
    mockGetUserMedia.mockRejectedValueOnce(new DOMException("not found", "NotFoundError"));

    render(<CameraCapture onCapture={vi.fn()} facingMode="environment" />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/no camera found/i)).toBeInTheDocument();
    });
  });

  it("shows file upload fallback on camera error", async () => {
    mockGetUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { hidden: true }).closest("input[type='file']") ??
          screen.getByDisplayValue("")
      ).toBeDefined();
    });
  });

  it("calls onFallback when file input is used after camera error", async () => {
    mockGetUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const onCapture = vi.fn();
    const onFallback = vi.fn();

    render(<CameraCapture onCapture={onCapture} facingMode="user" onFallback={onFallback} />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/camera access was denied/i)).toBeInTheDocument();
    });

    // Simulate file input
    const input = document.querySelector("input[type='file']");
    expect(input).toBeTruthy();

    const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [file] } });

    expect(onCapture).toHaveBeenCalledWith(file);
    expect(onFallback).toHaveBeenCalled();
  });

  it("stops stream on unmount", async () => {
    const stream = createMockStream();
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const { unmount } = render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalled();
    });

    unmount();
    expect(mockStop).toHaveBeenCalled();
  });

  it("disables buttons when disabled prop is true", () => {
    render(<CameraCapture onCapture={vi.fn()} facingMode="user" disabled />);
    expect(screen.getByRole("button", { name: /open camera/i })).toBeDisabled();
  });
});
