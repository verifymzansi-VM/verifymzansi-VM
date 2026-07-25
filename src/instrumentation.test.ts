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
  const originalNodeEnv = process.env.NODE_ENV;
  const originalStrictStartupBlock = process.env.STRICT_ENV_STARTUP_BLOCK;

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateEnv.mockReset();
    _resetInstrumentationForTesting();
    Object.defineProperty(process.env, "NODE_ENV", {
      value: originalNodeEnv,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    process.env.STRICT_ENV_STARTUP_BLOCK = originalStrictStartupBlock;
  });

  it("runs launch validation during bootstrap", async () => {
    await expect(register()).resolves.toBeUndefined();

    expect(mockValidateEnv).toHaveBeenCalledTimes(1);
    expect(mockValidateEnv).toHaveBeenCalledWith({ strict: false });
    expect(mockError).not.toHaveBeenCalled();
  });

  it("validates in strict mode when STRICT_ENV_STARTUP_BLOCK=1", async () => {
    process.env.STRICT_ENV_STARTUP_BLOCK = "1";

    await expect(register()).resolves.toBeUndefined();

    expect(mockValidateEnv).toHaveBeenCalledTimes(1);
    expect(mockValidateEnv).toHaveBeenCalledWith({ strict: true });
  });

  it("logs and blocks launch validation failures", async () => {
    mockValidateEnv.mockImplementation(() => {
      throw new Error("AFRICASTALKING_SENDER_ID is required in production");
    });

    await expect(register()).rejects.toThrow("AFRICASTALKING_SENDER_ID");
    await expect(register()).rejects.toThrow("AFRICASTALKING_SENDER_ID");

    expect(mockValidateEnv).toHaveBeenCalledTimes(2);
    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockError).toHaveBeenCalledWith(
      "Launch configuration validation failed during instrumentation bootstrap",
      expect.objectContaining({
        error: expect.stringContaining("AFRICASTALKING_SENDER_ID"),
      })
    );
  });

  it("soft-fails env validation in production unless strict block is enabled", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      writable: true,
      configurable: true,
      enumerable: true,
    });
    delete process.env.STRICT_ENV_STARTUP_BLOCK;

    mockValidateEnv.mockImplementation(() => {
      throw new Error("RESEND_API_KEY should start with re_");
    });

    await expect(register()).resolves.toBeUndefined();

    expect(mockValidateEnv).toHaveBeenCalledTimes(1);
    expect(mockError).toHaveBeenCalledTimes(2);
    expect(mockError).toHaveBeenNthCalledWith(
      1,
      "Launch configuration validation failed during instrumentation bootstrap",
      expect.objectContaining({
        error: expect.stringContaining("RESEND_API_KEY"),
      })
    );
    expect(mockError).toHaveBeenNthCalledWith(
      2,
      "Continuing startup with degraded launch configuration",
      expect.objectContaining({
        reason: expect.stringContaining("STRICT_ENV_STARTUP_BLOCK"),
      })
    );
  });

  it("blocks production startup when cafebabe placeholder keys are set", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      writable: true,
      configurable: true,
      enumerable: true,
    });
    delete process.env.STRICT_ENV_STARTUP_BLOCK;
    delete process.env.VERIFYMZANSI_RUNTIME_MODE;
    process.env.KYC_ENCRYPTION_KEY = "cafebabe".repeat(8);

    await expect(register()).rejects.toThrow("Production startup blocked");
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("placeholder encryption keys detected")
    );

    delete process.env.KYC_ENCRYPTION_KEY;
  });

  it("does not block e2e runtime from having cafebabe keys", async () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      writable: true,
      configurable: true,
      enumerable: true,
    });
    process.env.VERIFYMZANSI_RUNTIME_MODE = "e2e";
    process.env.KYC_ENCRYPTION_KEY = "cafebabe".repeat(8);

    // e2e mode skips the cafebabe guard — workers can run in CI with placeholder keys
    await expect(register()).resolves.toBeUndefined();

    delete process.env.KYC_ENCRYPTION_KEY;
    delete process.env.VERIFYMZANSI_RUNTIME_MODE;
  });
});
