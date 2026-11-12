import { z } from "zod";

/**
 * How the member's browser says the selfie was taken. This is review context
 * for staff, never a proof: the browser can claim anything, so nothing is
 * approved, scored or granted from it. It is checked against a closed set only
 * so the stored values stay meaningful.
 */
export type SelfieCaptureReport = {
  captureMethod: "camera" | "file_upload";
  browserLivenessPassed: boolean;
};

/**
 * Reads the selfie upload's `captureMethod` and `livenessPassed` form fields
 * (as the verification page sends them). Returns `null` when the browser sent
 * no capture method (nothing is recorded), the report when the fields are
 * consistent, or `"invalid"` for any other combination.
 */
export function readSelfieCaptureReport(
  captureMethod: FormDataEntryValue | null,
  livenessPassed: FormDataEntryValue | null
): SelfieCaptureReport | null | "invalid" {
  if (captureMethod === null) return livenessPassed === null ? null : "invalid";
  if (captureMethod !== "camera" && captureMethod !== "file_upload") return "invalid";
  if (livenessPassed !== null && livenessPassed !== "true" && livenessPassed !== "false")
    return "invalid";
  const passed = livenessPassed === "true";
  if (passed && captureMethod !== "camera") return "invalid";
  return { captureMethod, browserLivenessPassed: passed };
}

/** Exact answer of api.get_frontend_staff_selfie_capture. */
export const foundationSelfieCaptureSchema = z
  .strictObject({
    case_id: z.uuid(),
    case_version: z.number().int().positive(),
    submission_id: z.uuid(),
    selfie_artifact_id: z.uuid(),
    capture_method: z.enum(["camera", "file_upload"]).nullable(),
    browser_liveness_passed: z.boolean().nullable(),
  })
  .refine(
    (v) =>
      (v.capture_method === null) === (v.browser_liveness_passed === null) &&
      (v.browser_liveness_passed !== true || v.capture_method === "camera")
  );
export type FoundationSelfieCapture = z.infer<typeof foundationSelfieCaptureSchema>;

/**
 * The staff viewer's existing risk signals for a recorded capture report, tied
 * to the selfie. Nothing is shown when nothing was recorded (the viewer then
 * says "Liveness unknown").
 */
export function selfieCaptureSignals(
  capture: FoundationSelfieCapture,
  ownerId: string,
  createdAt: string
) {
  if (capture.capture_method === null) return [];
  const signal = (code: string, severity: "warn" | "info") => ({
    id: `${capture.submission_id}:${code}`,
    user_id: ownerId,
    artifact_id: capture.selfie_artifact_id,
    signal_code: code,
    severity,
    value_json: {
      source: "browser_reported",
      capture_method: capture.capture_method,
      browser_liveness_passed: capture.browser_liveness_passed,
    },
    created_at: createdAt,
  });
  if (capture.capture_method === "file_upload")
    return [signal("selfie_not_camera_captured", "warn")];
  return capture.browser_liveness_passed
    ? [signal("browser_liveness_claimed", "info")]
    : [signal("liveness_not_verified", "warn")];
}
