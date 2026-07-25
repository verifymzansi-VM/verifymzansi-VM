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
  mockGetUserMedia.mockReset();
  mockStop.mockReset();

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
  Object.defineProperty(global.navigator, "getUserMedia", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(global.navigator, "webkitGetUserMedia", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(global.navigator, "mozGetUserMedia", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(global.navigator, "msGetUserMedia", {
    configurable: true,
    value: undefined,
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

/** Click "Open Camera", which should directly call getUserMedia. */
async function clickOpenCamera() {
  fireEvent.click(screen.getByRole("button", { name: /open camera/i }));
}

describe("CameraCapture", () => {
  it("renders Open Camera button initially", () => {
    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    expect(screen.getByRole("button", { name: /open camera/i })).toBeInTheDocument();
  });

  it("requests browser camera access when Open Camera is clicked", async () => {
    const stream = createMockStream();
    mockGetUserMedia.mockResolvedValueOnce(stream);

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" telemetryContext="selfie" />);
    await clickOpenCamera();

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    });
  });

  it("requests camera access through the legacy API when mediaDevices is unavailable", async () => {
    const stream = createMockStream();
    const legacyGetUserMedia = vi.fn(
      (
        _constraints: MediaStreamConstraints,
        onSuccess: (stream: MediaStream) => void,
        _onError: (error: unknown) => void
      ) => {
        onSuccess(stream);
      }
    );

    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(global.navigator, "webkitGetUserMedia", {
      configurable: true,
      value: legacyGetUserMedia,
    });

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" telemetryContext="selfie" />);
    await clickOpenCamera();

    await waitFor(() => {
      expect(legacyGetUserMedia).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();
    });
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it("requests camera access even if the Permissions API lookup stalls", async () => {
    const stream = createMockStream();
    mockGetUserMedia.mockResolvedValueOnce(stream);

    Object.defineProperty(global.navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(
          () =>
            new Promise(() => {
              // Intentionally unresolved: getUserMedia must still run.
            })
        ),
      },
    });

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" telemetryContext="selfie" />);
    await clickOpenCamera();

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    });
  });

  it("starts camera stream after browser permission is granted", async () => {
    const stream = createMockStream();
    mockGetUserMedia.mockResolvedValueOnce(stream);

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    await clickOpenCamera();

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
    await clickOpenCamera();

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
    await clickOpenCamera();

    await waitFor(() => {
      expect(screen.getByText(/camera is blocked for this site/i)).toBeInTheDocument();
    });

    expect(query).toHaveBeenCalled();
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/may not show the camera prompt again/i)).toBeInTheDocument();
  });

  it("falls back to denied guidance when permission query fails", async () => {
    const err = new Error("denied");
    err.name = "NotAllowedError";
    mockGetUserMedia.mockRejectedValueOnce(err);

    const query = vi.fn().mockRejectedValue(new Error("unsupported"));
    Object.defineProperty(global.navigator, "permissions", {
      configurable: true,
      value: { query },
    });

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    await clickOpenCamera();

    await waitFor(() => {
      expect(screen.getByText(/camera access was denied/i)).toBeInTheDocument();
    });

    expect(query).toHaveBeenCalled();
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
  });

  it("shows denied guidance when permission query stalls after camera access is denied", async () => {
    const err = new Error("denied");
    err.name = "NotAllowedError";
    mockGetUserMedia.mockRejectedValueOnce(err);

    const query = vi.fn(
      () =>
        new Promise(() => {
          // Intentionally unresolved to verify the error UI is not blocked.
        })
    );
    Object.defineProperty(global.navigator, "permissions", {
      configurable: true,
      value: { query },
    });

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    await clickOpenCamera();

    await waitFor(
      () => {
        expect(screen.getByText(/camera access was denied/i)).toBeInTheDocument();
      },
      { timeout: 2_000 }
    );

    expect(query).toHaveBeenCalled();
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
  });

  it("shows timeout guidance when camera start takes too long", async () => {
    mockGetUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>(() => {
          // Intentionally unresolved to trigger timeout path
        })
    );

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" cameraStartTimeoutMs={1} />);
    await clickOpenCamera();

    await waitFor(() => {
      expect(screen.getByText(/camera took too long to start/i)).toBeInTheDocument();
    });
  });

  it("handles a synchronous camera API failure without waiting for timeout", async () => {
    const err = new Error("sync failure");
    err.name = "NotReadableError";
    mockGetUserMedia.mockImplementationOnce(() => {
      throw err;
    });

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" cameraStartTimeoutMs={60_000} />);
    await clickOpenCamera();

    await waitFor(() => {
      expect(screen.getByText(/no camera found/i)).toBeInTheDocument();
    });
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
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
    await clickOpenCamera();

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
    mockGetUserMedia.mockImplementation(
      () =>
        new Promise<MediaStream>(() => {
          // Keep pending to simulate a long-running camera start
        })
    );

    render(<CameraCapture onCapture={vi.fn()} facingMode="environment" />);
    await clickOpenCamera();

    // Wait for getUserMedia to be called once
    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    });
  });

  it("shows error message when no camera found", async () => {
    const err = new Error("not found");
    err.name = "NotFoundError";
    mockGetUserMedia.mockRejectedValue(err);

    render(<CameraCapture onCapture={vi.fn()} facingMode="environment" />);
    await clickOpenCamera();

    await waitFor(() => {
      expect(screen.getByText(/no camera found/i)).toBeInTheDocument();
    });

    expect(mockGetUserMedia).toHaveBeenCalledTimes(3);
  });

  it("falls back to any available camera when the requested facing mode is missing", async () => {
    const err = new Error("not found");
    err.name = "NotFoundError";
    const stream = createMockStream();
    mockGetUserMedia.mockRejectedValueOnce(err);
    mockGetUserMedia.mockRejectedValueOnce(err);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    render(<CameraCapture onCapture={vi.fn()} facingMode="environment" />);
    await clickOpenCamera();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /take photo/i })).toBeInTheDocument();
    });

    expect(mockGetUserMedia).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: "environment" }),
      })
    );
    expect(mockGetUserMedia).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        video: true,
      })
    );
  });

  it("shows file upload fallback on camera error", async () => {
    const err = new Error("denied");
    err.name = "NotAllowedError";
    mockGetUserMedia.mockRejectedValueOnce(err);

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    await clickOpenCamera();

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
    await clickOpenCamera();

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
    await clickOpenCamera();

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

  it("shows Try Again button on camera error and requests camera again on click", async () => {
    const err = new Error("denied");
    err.name = "NotAllowedError";
    mockGetUserMedia.mockRejectedValueOnce(err);

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    await clickOpenCamera();

    await waitFor(() => {
      expect(screen.getByText(/camera access was denied/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    expect(retryBtn).toBeInTheDocument();

    const stream = createMockStream();
    mockGetUserMedia.mockResolvedValueOnce(stream);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledTimes(2);
    });
  });

  it("requests camera again when Retake is clicked", async () => {
    const stream = createMockStream();
    mockGetUserMedia.mockResolvedValueOnce(stream);
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback) => {
        callback(new Blob(["img"], { type: "image/jpeg" }));
      });

    // Simulate a video stream that has loaded its first frame.
    const videoWidthSpy = vi
      .spyOn(HTMLVideoElement.prototype, "videoWidth", "get")
      .mockReturnValue(640);
    const videoHeightSpy = vi
      .spyOn(HTMLVideoElement.prototype, "videoHeight", "get")
      .mockReturnValue(480);
    const readyStateSpy = vi
      .spyOn(HTMLVideoElement.prototype, "readyState", "get")
      .mockReturnValue(4);

    render(<CameraCapture onCapture={vi.fn()} facingMode="user" />);
    await clickOpenCamera();

    const takePhotoBtn = await screen.findByRole("button", { name: /take photo/i });
    fireEvent.click(takePhotoBtn);

    const retakeBtn = await screen.findByRole("button", { name: /retake/i });
    fireEvent.click(retakeBtn);

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledTimes(2);
    });

    getContextSpy.mockRestore();
    toBlobSpy.mockRestore();
    videoWidthSpy.mockRestore();
    videoHeightSpy.mockRestore();
    readyStateSpy.mockRestore();
  });

  it("does not capture a photo before the video stream has a frame", async () => {
    const stream = createMockStream();
    mockGetUserMedia.mockResolvedValueOnce(stream);

    const onCapture = vi.fn();
    render(<CameraCapture onCapture={onCapture} facingMode="user" />);
    await clickOpenCamera();

    const takePhotoBtn = await screen.findByRole("button", { name: /take photo/i });
    fireEvent.click(takePhotoBtn);

    // jsdom videos never load (videoWidth 0 / readyState 0), so the capture
    // guard must block the blank-frame capture.
    expect(onCapture).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /retake/i })).not.toBeInTheDocument();
  });
});
