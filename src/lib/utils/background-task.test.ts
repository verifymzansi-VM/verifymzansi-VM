import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAfter, mockError } = vi.hoisted(() => ({
  mockAfter: vi.fn(),
  mockError: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mockAfter }));
vi.mock("./logger", () => ({ createLogger: () => ({ error: mockError }) }));

import { scheduleBackgroundTask } from "./background-task";

describe("scheduleBackgroundTask", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("registers pending work before returning and keeps it pending until completion", async () => {
    let finish!: () => void;
    const task = new Promise<void>((resolve) => {
      finish = resolve;
    });
    scheduleBackgroundTask(task, "owner notification");
    expect(mockAfter).toHaveBeenCalledTimes(1);
    const registered = mockAfter.mock.calls[0][0] as Promise<unknown>;
    let completed = false;
    void registered.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    finish();
    await registered;
    expect(completed).toBe(true);
  });

  it("observes rejection without rejecting the platform lifetime promise", async () => {
    scheduleBackgroundTask(Promise.reject(new Error("database unavailable")), "staff notification");
    await expect(mockAfter.mock.calls[0][0]).resolves.toBeUndefined();
    expect(mockError).toHaveBeenCalledWith("Background task failed", {
      label: "staff notification",
      error: "database unavailable",
    });
  });

  it("observes failures even outside a request scope", async () => {
    mockAfter.mockImplementation(() => {
      throw new Error("outside request scope");
    });
    scheduleBackgroundTask(Promise.reject(new Error("send failed")), "SMS");
    await Promise.resolve();
    expect(mockError).toHaveBeenCalledWith("Background task failed", {
      label: "SMS",
      error: "send failed",
    });
  });

  it("reports registration failures in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    mockAfter.mockImplementation(() => {
      throw new Error("waitUntil unavailable");
    });
    scheduleBackgroundTask(Promise.resolve(), "SMS");
    expect(mockError).toHaveBeenCalledWith("Background task registration failed", {
      label: "SMS",
      error: "waitUntil unavailable",
    });
  });
});
