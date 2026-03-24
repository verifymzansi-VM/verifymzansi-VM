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

  it("preserves explicit non-upload errors", () => {
    expect(
      normalizeCreatePostRuntimeError(new Error("Free post already used"), "Fallback message")
    ).toBe("Free post already used");
  });
});
