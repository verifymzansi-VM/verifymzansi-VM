import { describe, it, expect, vi } from "vitest";
import { isArtifactMissingInStorage, diagnoseDownloadFailure } from "./kyc-artifact-diagnostics";

describe("isArtifactMissingInStorage", () => {
  it("returns false when download succeeds", async () => {
    const downloadFn = vi.fn().mockResolvedValue(Buffer.from("data"));
    expect(await isArtifactMissingInStorage(downloadFn, "key-1")).toBe(false);
  });

  it("returns true for 'not found' error", async () => {
    const downloadFn = vi.fn().mockRejectedValue(new Error("NoSuchKey: key not found"));
    expect(await isArtifactMissingInStorage(downloadFn, "key-2")).toBe(true);
  });

  it("returns true for '404' error", async () => {
    const downloadFn = vi.fn().mockRejectedValue(new Error("404 Not Found"));
    expect(await isArtifactMissingInStorage(downloadFn, "key-3")).toBe(true);
  });

  it("returns false for non-missing errors (e.g. network)", async () => {
    const downloadFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await isArtifactMissingInStorage(downloadFn, "key-4")).toBe(false);
  });
});

describe("diagnoseDownloadFailure", () => {
  it("identifies missing file", () => {
    const result = diagnoseDownloadFailure(new Error("NoSuchKey: not found"));
    expect(result.type).toBe("missing_file");
    expect(result.isRecoverable).toBe(false);
  });

  it("identifies decryption error", () => {
    const result = diagnoseDownloadFailure(new Error("Decipher auth fail"));
    expect(result.type).toBe("decryption_error");
    expect(result.isRecoverable).toBe(false);
  });

  it("identifies corruption", () => {
    const result = diagnoseDownloadFailure(new Error("Invalid or malformed data"));
    expect(result.type).toBe("corruption");
    expect(result.isRecoverable).toBe(false);
  });

  it("identifies network error as recoverable", () => {
    const result = diagnoseDownloadFailure(new Error("ECONNREFUSED timeout"));
    expect(result.type).toBe("network_error");
    expect(result.isRecoverable).toBe(true);
  });

  it("falls back to unknown for unrecognized errors", () => {
    const result = diagnoseDownloadFailure(new Error("unexpected"));
    expect(result.type).toBe("unknown");
    expect(result.isRecoverable).toBe(false);
  });

  it("handles non-Error values", () => {
    const result = diagnoseDownloadFailure("string error");
    expect(result.type).toBe("unknown");
    expect(result.message).toBe("string error");
  });
});
