import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: sentryMocks.captureMessage,
  withScope: (
    callback: (scope: {
      setTag: typeof sentryMocks.setTag;
      setContext: typeof sentryMocks.setContext;
    }) => void
  ) => {
    callback({ setTag: sentryMocks.setTag, setContext: sentryMocks.setContext });
  },
}));

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

  Object.defineProperty(global.navigator, "permissions", {
    configurable: true,
    value: {
      query: vi.fn().mockResolvedValue({ state: "prompt" }),
    },
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
    const err = new Error("denied");
    err.name = "NotAllowedError";
    mockGetUserMedia.mockRejectedValueOnce(err);

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/camera access was denied/i)).toBeInTheDocument();
    });
  });

  it("shows blocked-for-site guidance when permission state is denied", async () => {
    const err = new Error("denied");
    err.name = "NotAllowedError";
    mockGetUserMedia.mockRejectedValueOnce(err);

    const query = vi.fn().mockResolvedValue({ state: "denied" });
    Object.defineProperty(global.navigator, "permissions", {
      configurable: true,
      value: { query },
    });

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/camera is blocked for this site/i)).toBeInTheDocument();
    });

    expect(query).toHaveBeenCalled();
  });

  it("shows timeout guidance when camera start takes too long", async () => {
    mockGetUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>(() => {
          // Intentionally unresolved to trigger timeout path
        })
    );

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" cameraStartTimeoutMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/camera took too long to start/i)).toBeInTheDocument();
    });
  });

  it("stops late camera stream after timeout", async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    mockGetUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        })
    );

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" cameraStartTimeoutMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/camera took too long to start/i)).toBeInTheDocument();
    });

    const stream = createMockStream();
    if (!resolveStream) {
      throw new Error("Expected getUserMedia resolver to be captured");
    }
    resolveStream(stream);

    await waitFor(() => {
      expect(mockStop).toHaveBeenCalled();
    });
  });

  it("prevents duplicate camera-start attempts while one is in progress", async () => {
    mockGetUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>(() => {
          // Keep pending to simulate a long-running camera start
        })
    );

    render(<CameraCapture onCapture={vi.fn()} facingMode="environment" />);
    const openButton = screen.getByRole("button", { name: /open camera/i });

    fireEvent.click(openButton);
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    });
  });

  it("shows error message when no camera found", async () => {
    const err = new Error("not found");
    err.name = "NotFoundError";
    mockGetUserMedia.mockRejectedValueOnce(err);

    render(<CameraCapture onCapture={vi.fn()} facingMode="environment" />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/no camera found/i)).toBeInTheDocument();
    });
  });

  it("shows file upload fallback on camera error", async () => {
    const err = new Error("denied");
    err.name = "NotAllowedError";
    mockGetUserMedia.mockRejectedValueOnce(err);

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      const input = document.querySelector("input[type='file']");
      expect(input).toBeTruthy();
    });

    const helpLink = screen.getByRole("link", { name: /verification help/i });
    expect(helpLink).toHaveAttribute("href", "/help/verification");
  });

  it("calls onFallback when file input is used after camera error", async () => {
    const err = new Error("denied");
    err.name = "NotAllowedError";
    mockGetUserMedia.mockRejectedValueOnce(err);
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

  it("shows Try Again button on camera error and retries on click", async () => {
    const err = new Error("denied");
    err.name = "NotAllowedError";
    mockGetUserMedia.mockRejectedValueOnce(err);

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    fireEvent.click(screen.getByRole("button", { name: /open camera/i }));

    await waitFor(() => {
      expect(screen.getByText(/camera access was denied/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    expect(retryBtn).toBeInTheDocument();

    // Second attempt succeeds
    const stream = createMockStream();
    mockGetUserMedia.mockResolvedValueOnce(stream);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledTimes(2);
    });
  });
});
