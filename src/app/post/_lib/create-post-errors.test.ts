import { describe, expect, it } from "vitest";
import { normalizeCreatePostRuntimeError } from "./create-post-errors";

describe("normalizeCreatePostRuntimeError", () => {
  it("maps raw fetch failures to a user-friendly upload message", () => {
    expect(
      normalizeCreatePostRuntimeError(new TypeError("Failed to fetch"), "Fallback message")
    ).toBe("We couldn't reach the upload service. Check your connection and try again.");
  });

  it("maps video upload failures to a specific recovery message", () => {
    expect(
      normalizeCreatePostRuntimeError(new Error("Failed to upload video"), "Fallback message")
    ).toBe(
      "Video upload could not be completed. Check your connection and try again. You can remove the video and submit again."
    );
  });

  it("maps generic upload failures to a file upload message", () => {
    expect(normalizeCreatePostRuntimeError(new Error("Upload failed"), "Fallback message")).toBe(
      "One or more files could not be uploaded. Check your connection and try again."
    );
  });

  it("maps upload service misconfiguration errors to a temporary service message", () => {
    expect(
      normalizeCreatePostRuntimeError(new Error("Upload service misconfigured"), "Fallback")
    ).toBe("Upload service is temporarily unavailable. Please try again in a moment.");
  });

  it("maps upload URL generation failures to a temporary service message", () => {
    expect(
      normalizeCreatePostRuntimeError(new Error("Failed to generate upload URL"), "Fallback")
    ).toBe("Upload service is temporarily unavailable. Please try again in a moment.");
  });

  it("preserves explicit non-upload errors", () => {
    expect(
      normalizeCreatePostRuntimeError(new Error("Free post already used"), "Fallback message")
    ).toBe("Free post already used");
  });

  it("preserves the new free-post limit message", () => {
    expect(
      normalizeCreatePostRuntimeError(new Error("Free post limit reached"), "Fallback message")
    ).toBe("Free post limit reached");
  });

  it("maps UploadServiceUnreachableError by name", () => {
    const err = new Error("Upload service is not reachable. Check your connection and try again.");
    err.name = "UploadServiceUnreachableError";
    expect(normalizeCreatePostRuntimeError(err, "Fallback")).toBe(
      "Upload service is not reachable. Check your connection and try again."
    );
  });

  it("maps CSRF errors to a security-check message", () => {
    expect(normalizeCreatePostRuntimeError(new Error("Security check failed"), "Fallback")).toBe(
      "Security check failed. Please refresh the page and try again."
    );
  });

  it("maps session/auth errors to a sign-in message", () => {
    expect(normalizeCreatePostRuntimeError(new Error("Unauthorized"), "Fallback")).toBe(
      "Your session has expired. Please sign in again and retry."
    );
  });
});
