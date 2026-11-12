import { describe, expect, it } from "vitest";
import { presentedReturnReason } from "./verification-return-reason";

describe("presentedReturnReason", () => {
  it("splits the identity review's stored form into code and explanation", () => {
    expect(
      presentedReturnReason(
        "Retake requested (incomplete_info): Fit all four corners in the guide."
      )
    ).toEqual({
      reason_code: "incomplete_info",
      reason_note: "Fit all four corners in the guide.",
    });
    expect(presentedReturnReason("Rejected (other): Line one.\nLine two.")).toEqual({
      reason_code: "other",
      reason_note: "Line one.\nLine two.",
    });
  });
  it("keeps the explanation of a code the page does not know, without the code", () => {
    expect(presentedReturnReason("Retake requested (not_a_code): Keep the camera steady.")).toEqual(
      {
        reason_code: null,
        reason_note: "Keep the camera steady.",
      }
    );
  });
  it("keeps any other text as written", () => {
    for (const reason of ["Retake requested (blurry_image): ", "Please send a sharper photo."])
      expect(presentedReturnReason(reason)).toEqual({
        reason_code: null,
        reason_note: reason.trim(),
      });
  });
  it("gives nothing for a missing reason", () => {
    for (const reason of [null, undefined, "", "   "])
      expect(presentedReturnReason(reason)).toEqual({ reason_code: null, reason_note: null });
  });
});
