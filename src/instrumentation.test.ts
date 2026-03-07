import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockValidateEnv, mockError } = vi.hoisted(() => ({
  mockValidateEnv: vi.fn(),
  mockError: vi.fn(),
}));

vi.mock("./lib/config/env", () => ({
  validateEnv: mockValidateEnv,
}));

vi.mock("./lib/utils/logger", () => ({
  createLogger: () => ({
    error: mockError,
  }),
}));

import { _resetInstrumentationForTesting, register } from "./instrumentation";

describe("instrumentation register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetInstrumentationForTesting();
  });

  it("runs launch validation during bootstrap", async () => {
    await expect(register()).resolves.toBeUndefined();

    expect(mockValidateEnv).toHaveBeenCalledTimes(1);
    expect(mockError).not.toHaveBeenCalled();
  });

  it("logs and swallows launch validation failures", async () => {
    mockValidateEnv.mockImplementation(() => {
      throw new Error("AFRICASTALKING_SENDER_ID is required in production");
    });

    await expect(register()).resolves.toBeUndefined();
    await expect(register()).resolves.toBeUndefined();

    expect(mockValidateEnv).toHaveBeenCalledTimes(2);
    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockError).toHaveBeenCalledWith(
      "Launch configuration validation failed during instrumentation bootstrap",
      expect.objectContaining({
        error: expect.stringContaining("AFRICASTALKING_SENDER_ID"),
      })
    );
  });
});
