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
  it("finishes blink then right turn even when the moving face leaves the photo guide", async () => {
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((values) => {
      (values as Uint32Array)[0] = Math.floor(0.9 * 2 ** 32);
      return values;
    });
    let landmarks: Array<{ x: number; y: number; z: number }> = [];
    const model = { close: vi.fn(), detectForVideo: vi.fn(() => ({ faceLandmarks: [landmarks] })) };
    mocks.create.mockResolvedValueOnce(model);
    const camera = video();
    let cameraTime = 0;
    Object.defineProperties(camera, {
      videoWidth: { value: 720 },
      videoHeight: { value: 960 },
      clientWidth: { value: 360 },
      clientHeight: { value: 600 },
      readyState: { value: 4 },
      paused: { value: false },
      currentTime: { get: () => cameraTime },
    });
    const { result } = renderHook(() => useFaceLiveness());
    await act(async () => {
      await result.current.start(camera);
    });
    const frame = async (closed = false, yaw = 0, shift = 0) => {
      landmarks = Array.from({ length: 478 }, () => ({ x: 0.5 + shift, y: 0.5, z: 0 }));
      landmarks[0] = { x: 0.3 + shift, y: 0.3, z: 0 };
      landmarks[2] = { x: 0.7 + shift, y: 0.7, z: 0 };
      landmarks[234] = { x: 0.3 + shift, y: 0.5, z: 0 };
      landmarks[454] = { x: 0.7 + shift, y: 0.5, z: 0 };
      landmarks[1] = { x: 0.5 + shift + yaw * 0.4, y: 0.5, z: 0 };
      for (const [indices, x] of [
        [[33, 160, 158, 133, 153, 144], 0.38],
        [[362, 385, 387, 263, 373, 380], 0.55],
      ] as const) {
        const gap = closed ? 0.002 : 0.01;
        const points = [
          [x, 0.45],
          [x + 0.02, 0.45 - gap],
          [x + 0.04, 0.45 - gap],
          [x + 0.06, 0.45],
          [x + 0.04, 0.45 + gap],
          [x + 0.02, 0.45 + gap],
        ];
        indices.forEach((index, i) => {
          landmarks[index] = { x: points[i][0] + shift, y: points[i][1], z: 0 };
        });
      }
      cameraTime += 0.1;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    };
    for (let i = 0; i < 3; i++) await frame();
    await frame(true);
    for (let i = 0; i < 4; i++) await frame();
    expect(result.current.status.completedSteps).toBe(1);
    await frame(false, -0.22, 0.18);
    expect(result.current.status).toMatchObject({ completedSteps: 1, faceOk: false });
    expect(result.current.status.instruction).toMatch(/right/);
    await frame(false, -0.22, 0.18);
    await frame(false, -0.22, 0.18);
    expect(result.current.canCapture()).toBe(false);
    for (let i = 0; i < 3; i++) await frame();
    expect(result.current.status).toMatchObject({ completedSteps: 2, livenessPassed: true });
    expect(result.current.canCapture()).toBe(true);
    random.mockRestore();
  });
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
