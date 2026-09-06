import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), fileset: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: mocks.fileset },
  FaceLandmarker: { createFromOptions: mocks.create },
}));
import { useFaceLiveness } from "./use-face-liveness";

beforeEach(() => {
  vi.useFakeTimers();
  mocks.create.mockReset();
  mocks.fileset.mockReset();
  mocks.fileset.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const video = () => document.createElement("video");

describe("face model lifecycle", () => {
  it("falls back to CPU when GPU initialization fails", async () => {
    const model = { close: vi.fn(), detectForVideo: vi.fn() };
    mocks.create.mockRejectedValueOnce(new Error("GPU unavailable")).mockResolvedValueOnce(model);
    const { result, unmount } = renderHook(() => useFaceLiveness());
    await act(async () => {
      await result.current.start(video());
    });
    expect(result.current.status.phase).toBe("ready");
    expect(mocks.create.mock.calls[1][1].baseOptions.delegate).toBe("CPU");
    unmount();
    expect(model.close).toHaveBeenCalledOnce();
  });
  it("does not let a stopped load change a newer session", async () => {
    let finish!: (value: unknown) => void;
    const stale = { close: vi.fn(), detectForVideo: vi.fn() };
    const current = { close: vi.fn(), detectForVideo: vi.fn() };
    mocks.create
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValueOnce(current);
    const { result } = renderHook(() => useFaceLiveness());
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.start(video());
    });
    await act(async () => {
      await result.current.start(video());
    });
    await act(async () => {
      finish(stale);
      await first;
    });
    expect(stale.close).toHaveBeenCalledOnce();
    expect(current.close).not.toHaveBeenCalled();
    expect(result.current.status.phase).toBe("ready");
  });
  it("bounds model loading and releases a late result", async () => {
    let finish!: (value: unknown) => void;
    const model = { close: vi.fn(), detectForVideo: vi.fn() };
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { result } = renderHook(() => useFaceLiveness());
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.start(video());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_001);
      await pending;
    });
    expect(result.current.status.supported).toBe(false);
    expect(result.current.canCapture()).toBe(false);
    await act(async () => {
      finish(model);
    });
    expect(model.close).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("never considers an undetected or frozen video frame eligible", async () => {
    const model = { close: vi.fn(), detectForVideo: vi.fn() };
    mocks.create.mockResolvedValueOnce(model);
    const { result } = renderHook(() => useFaceLiveness());
    await act(async () => {
      await result.current.start(video());
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.canCapture()).toBe(false);
    expect(result.current.status.livenessPassed).toBe(false);
  });
});
